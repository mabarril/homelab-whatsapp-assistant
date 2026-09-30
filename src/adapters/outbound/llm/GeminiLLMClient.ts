import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  LLMServicePort,
  GenerateResponseOptions,
  LLMUnavailableError,
} from '../../../core/application/ports/out/LLMServicePort.js';
import { PrintCalculation, PrintSettings } from '../../../core/domain/entities/PrintCalculation.js';

export function formatCalculationToWhatsApp(calc: PrintCalculation, settings: PrintSettings): string {
  return [
    `🖨️ *Cálculo de Impressão 3D*`,
    `📌 *Projeto:* ${calc.projectName}`,
    `⚖️ *Peso:* ${calc.weightGrams}g`,
    `⏱️ *Tempo:* ${calc.printTimeHours}h`,
    ``,
    `📊 *Detalhamento dos Custos:*`,
    `• Filamento (R$ ${settings.filamentCostPerKg.toFixed(2)}/kg): R$ ${calc.materialCost.toFixed(2)}`,
    `• Energia (${calc.kwhConsumed.toFixed(3)} kWh @ R$ ${settings.kwhCost.toFixed(2)}/kWh): R$ ${calc.energyCost.toFixed(2)}`,
    `• Depreciação (R$ ${settings.depreciationCostPerHour.toFixed(2)}/h): R$ ${calc.depreciationCost.toFixed(2)}`,
    `💵 *Custo Total de Fabricação:* *R$ ${calc.totalCost.toFixed(2)}*`,
    ``,
    `🏷️ *Sugestões de Preço de Venda:*`,
    `• Margem de 30%: *R$ ${calc.priceProfit30.toFixed(2)}* (Lucro: R$ ${(calc.priceProfit30 - calc.totalCost).toFixed(2)})`,
    `• Margem de 50%: *R$ ${calc.priceProfit50.toFixed(2)}* (Lucro: R$ ${(calc.priceProfit50 - calc.totalCost).toFixed(2)})`,
    `• Margem de 100%: *R$ ${calc.priceProfit100.toFixed(2)}* (Lucro: R$ ${(calc.priceProfit100 - calc.totalCost).toFixed(2)})`,
  ].join('\n');
}

export function formatSettingsToWhatsApp(settings: PrintSettings): string {
  return [
    `⚙️ *Tabela de Parâmetros de Impressão 3D*`,
    `• Custo do Filamento: *R$ ${settings.filamentCostPerKg.toFixed(2)} / kg*`,
    `• Potência da Impressora: *${settings.printerPowerWatts} Watts*`,
    `• Custo da Energia: *R$ ${settings.kwhCost.toFixed(2)} / kWh*`,
    `• Taxa de Depreciação: *R$ ${settings.depreciationCostPerHour.toFixed(2)} / hora*`,
    `_Última atualização: ${settings.updatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}_`,
  ].join('\n');
}

// Máximo de rodadas "modelo pede ferramenta -> devolvemos resultado" por mensagem.
const MAX_TOOL_ROUNDS = 4;

// Limites alinhados com as colunas NUMERIC(10,2) / VARCHAR(150) do init.sql.
const MONEY_MAX = 1_000_000;

const calculateArgsSchema = z.object({
  projectName: z.string().trim().min(1).max(150),
  weightGrams: z.number().positive().max(100_000),
  printTimeHours: z.number().positive().max(1_000),
});

const updateSettingsArgsSchema = z
  .object({
    filamentCostPerKg: z.number().nonnegative().max(MONEY_MAX).optional(),
    printerPowerWatts: z.number().nonnegative().max(100_000).optional(),
    kwhCost: z.number().nonnegative().max(MONEY_MAX).optional(),
    depreciationCostPerHour: z.number().nonnegative().max(MONEY_MAX).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um parâmetro para atualizar.',
  });

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** O nome vem do perfil do WhatsApp (controlado por quem envia): limpa antes de ir para o prompt. */
function sanitizeDisplayName(name: string): string {
  const cleaned = name
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\p{L}\p{N} .'-]/gu, '')
    .trim()
    .slice(0, 50);
  return cleaned || 'usuário';
}

// Subconjunto do cliente do SDK que usamos (facilita injetar um dublê em testes).
export interface GenAIClientLike {
  models: { generateContent(params: any): Promise<any> };
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'calculate3dPrint',
        description:
          'Calcula o custo de impressão 3D (material, energia, depreciação) e margens de lucro recomendadas. Use os parâmetros de custo atuais do usuário.',
        parameters: {
          type: 'OBJECT' as const,
          properties: {
            projectName: {
              type: 'STRING' as const,
              description: 'Nome da peça ou projeto impresso (ex: Suporte de Fone, Case Raspberry)',
            },
            weightGrams: {
              type: 'NUMBER' as const,
              description: 'Peso em gramas do filamento utilizado',
            },
            printTimeHours: {
              type: 'NUMBER' as const,
              description: 'Tempo total de impressão em horas decimais (ex: 3.5 para 3 horas e 30 minutos)',
            },
          },
          required: ['projectName', 'weightGrams', 'printTimeHours'],
        },
      },
      {
        name: 'updatePrintSettings',
        description: 'Atualiza os custos base da impressora (filamento, energia, potência ou depreciação).',
        parameters: {
          type: 'OBJECT' as const,
          properties: {
            filamentCostPerKg: { type: 'NUMBER' as const, description: 'Preço do filamento por kg em reais' },
            printerPowerWatts: { type: 'NUMBER' as const, description: 'Potência média da impressora em Watts' },
            kwhCost: { type: 'NUMBER' as const, description: 'Custo do kWh em reais' },
            depreciationCostPerHour: { type: 'NUMBER' as const, description: 'Custo de depreciação por hora em reais' },
          },
        },
      },
      {
        name: 'getPrintSettings',
        description: 'Consulta a tabela atual de custos e configurações de impressão 3D do usuário.',
        parameters: {
          type: 'OBJECT' as const,
          properties: {},
        },
      },
    ],
  },
];

export class GeminiLLMClient implements LLMServicePort {
  private readonly ai: GenAIClientLike;
  private readonly modelName: string;

  constructor(apiKey: string, modelName: string = 'gemini-2.5-flash', ai?: GenAIClientLike) {
    this.ai = ai ?? (new GoogleGenAI({ apiKey }) as unknown as GenAIClientLike);
    this.modelName = modelName;
  }

  async generateResponse(options: GenerateResponseOptions): Promise<string> {
    const { user, conversationHistory, currentMessage, printSettings } = options;

    const systemInstruction = `
Você é o Assistente Pessoal do Homelab do ${sanitizeDisplayName(user.name)}, integrado ao WhatsApp.
Seu papel é ser prestativo, técnico quando necessário e muito amigável.
Você tem especialidade em:
1. Impressão 3D (FDM/Resina, fatiadores, calibragem, filamentos PLA, PETG, ABS, Anycubic).
2. Infraestrutura Homelab (Docker, Linux, redes, self-hosting, automações).
3. Cálculos de custos de impressão e orçamentos de peças.

Configurações de impressão do usuário no início desta conversa (podem ter mudado; o resultado das ferramentas é a fonte da verdade):
- Custo Filamento: R$ ${printSettings.filamentCostPerKg}/kg
- Potência: ${printSettings.printerPowerWatts}W
- Energia: R$ ${printSettings.kwhCost}/kWh
- Depreciação: R$ ${printSettings.depreciationCostPerHour}/hora

Instruções para o WhatsApp:
- Use emojis amigáveis e formatação WhatsApp (*negrito*, _itálico_, listas com marcadores).
- Seja direto e objetivo, sem enrolações.
- Quando o usuário solicitar cálculo de impressão ou mudança de parâmetros, acione as ferramentas disponíveis. Se faltar algum dado obrigatório (peso, tempo ou nome da peça), pergunte ao usuário em vez de inventar valores.
- Depois de executar uma ferramenta, responda reproduzindo exatamente o campo "mensagemFormatada" do resultado (já está no formato do WhatsApp). Você pode acrescentar no máximo duas linhas de comentário depois dele. Se o resultado trouxer "ok": false, explique o problema ao usuário de forma simples e peça o dado correto.
    `.trim();

    // Mapeia histórico de conversas no formato do Gemini
    const contents: any[] = conversationHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: currentMessage }] });

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.callModel(contents, systemInstruction);
      const functionCalls: any[] = response.functionCalls ?? [];

      // Sem chamadas de ferramenta: é a resposta final em texto.
      if (functionCalls.length === 0) {
        const text = typeof response.text === 'string' ? response.text.trim() : '';
        return text.length > 0 ? text : 'Desculpe, não consegui gerar uma resposta no momento.';
      }

      if (round === MAX_TOOL_ROUNDS) break;

      // Devolve ao modelo o turno dele exatamente como veio (preserva as
      // assinaturas de raciocínio do Gemini 2.5) e o resultado de TODAS as
      // ferramentas pedidas, na mesma ordem.
      const modelContent = response.candidates?.[0]?.content;
      contents.push(
        modelContent ?? { role: 'model', parts: functionCalls.map((call) => ({ functionCall: call })) }
      );

      const responseParts: any[] = [];
      for (const call of functionCalls) {
        const result = await this.executeTool(String(call.name), call.args, options);
        responseParts.push({
          functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response: result,
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    throw new LLMUnavailableError(
      `O modelo excedeu o limite de ${MAX_TOOL_ROUNDS} rodadas de chamadas de ferramenta.`
    );
  }

  private async callModel(contents: any[], systemInstruction: string): Promise<any> {
    try {
      return await this.ai.models.generateContent({
        model: this.modelName,
        contents,
        config: { systemInstruction, tools: TOOLS },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMUnavailableError(`Erro ao chamar a API do Gemini: ${msg}`, { cause: err });
    }
  }

  /**
   * Executa uma ferramenta e devolve um objeto para o modelo. Erros de validação
   * ou de infraestrutura NÃO derrubam a conversa: voltam como { ok: false } para
   * o modelo explicar ao usuário (detalhes técnicos ficam só no log).
   */
  private async executeTool(
    name: string,
    args: unknown,
    options: GenerateResponseOptions
  ): Promise<Record<string, unknown>> {
    try {
      switch (name) {
        case 'calculate3dPrint': {
          const parsed = calculateArgsSchema.safeParse(args ?? {});
          if (!parsed.success) return { ok: false, erro: formatZodError(parsed.error) };
          // Com `strict: false` o zod infere campos opcionais; o safeParse acima já garantiu que existem.
          const { calculation, settings } = await options.onExecutePrintCalculation(
            parsed.data as z.infer<typeof calculateArgsSchema> & { projectName: string; weightGrams: number; printTimeHours: number }
          );
          return { ok: true, mensagemFormatada: formatCalculationToWhatsApp(calculation, settings) };
        }

        case 'updatePrintSettings': {
          const parsed = updateSettingsArgsSchema.safeParse(args ?? {});
          if (!parsed.success) return { ok: false, erro: formatZodError(parsed.error) };
          const updated = await options.onUpdatePrintSettings(parsed.data);
          return {
            ok: true,
            mensagemFormatada: `✅ *Configurações atualizadas com sucesso!*\n\n${formatSettingsToWhatsApp(updated)}`,
          };
        }

        case 'getPrintSettings': {
          const settings = await options.onGetPrintSettings();
          return { ok: true, mensagemFormatada: formatSettingsToWhatsApp(settings) };
        }

        default:
          return { ok: false, erro: `Ferramenta desconhecida: ${name}` };
      }
    } catch (err: unknown) {
      console.error(`[GeminiLLMClient] Falha ao executar a ferramenta ${name}:`, err);
      return { ok: false, erro: 'Falha interna ao executar a ferramenta. Tente novamente mais tarde.' };
    }
  }
}
