import { GoogleGenAI } from '@google/genai';
import { LLMServicePort, GenerateResponseOptions } from '../../../core/application/ports/out/LLMServicePort.js';
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
    `_Última atualização: ${settings.updatedAt.toLocaleString('pt-BR')}_`,
  ].join('\n');
}

export class GeminiLLMClient implements LLMServicePort {
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;

  constructor(apiKey: string, modelName: string = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async generateResponse(options: GenerateResponseOptions): Promise<string> {
    const { user, conversationHistory, currentMessage, printSettings } = options;

    const systemInstruction = `
Você é o Assistente Pessoal do Homelab do ${user.name}, integrado ao WhatsApp.
Seu papel é ser prestativo, técnico quando necessário e muito amigável.
Você tem especialidade em:
1. Impressão 3D (FDM/Resina, fatiadores, calibragem, filamentos PLA, PETG, ABS, Anycubic).
2. Infraestrutura Homelab (Docker, Linux, redes, self-hosting, automações).
3. Cálculos de custos de impressão e orçamentos de peças.

Configurações atuais de impressão do usuário:
- Custo Filamento: R$ ${printSettings.filamentCostPerKg}/kg
- Potência: ${printSettings.printerPowerWatts}W
- Energia: R$ ${printSettings.kwhCost}/kWh
- Depreciação: R$ ${printSettings.depreciationCostPerHour}/hora

Instruções para o WhatsApp:
- Use emojis amigáveis e formatação WhatsApp (*negrito*, _itálico_, listas com marcadores).
- Seja direto e objetivo, sem enrolações.
- Quando o usuário solicitar cálculo de impressão ou mudança de parâmetros, acione as ferramentas disponíveis.
    `.trim();

    // Mapeia histórico de conversas no formato do Gemini
    const contents: any[] = [];

    for (const msg of conversationHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    // Adiciona mensagem atual
    contents.push({
      role: 'user',
      parts: [{ text: currentMessage }],
    });

    const tools = [
      {
        functionDeclarations: [
          {
            name: 'calculate3dPrint',
            description: 'Calcula o custo de impressão 3D (material, energia, depreciação) e margens de lucro recomendadas.',
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

    try {
      const response: any = await (this.ai.models as any).generateContent({
        model: this.modelName,
        contents,
        config: {
          systemInstruction,
          tools: tools as any,
        },
      });

      // Checa se o modelo chamou alguma função
      const functionCalls = (response as any).functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        const args = call.args || {};

        if (call.name === 'calculate3dPrint') {
          const calc = await options.onExecutePrintCalculation({
            projectName: String(args.projectName || 'Peça 3D'),
            weightGrams: Number(args.weightGrams || 0),
            printTimeHours: Number(args.printTimeHours || 0),
          });
          return formatCalculationToWhatsApp(calc, printSettings);
        }

        if (call.name === 'updatePrintSettings') {
          const updated = await options.onUpdatePrintSettings({
            filamentCostPerKg: args.filamentCostPerKg ? Number(args.filamentCostPerKg) : undefined,
            printerPowerWatts: args.printerPowerWatts ? Number(args.printerPowerWatts) : undefined,
            kwhCost: args.kwhCost ? Number(args.kwhCost) : undefined,
            depreciationCostPerHour: args.depreciationCostPerHour ? Number(args.depreciationCostPerHour) : undefined,
          });
          return `✅ *Configurações atualizadas com sucesso!*\n\n${formatSettingsToWhatsApp(updated)}`;
        }

        if (call.name === 'getPrintSettings') {
          return formatSettingsToWhatsApp(printSettings);
        }
      }

      // Resposta textual padrão do Gemini
      const text = response.text;
      if (text && text.trim().length > 0) {
        return text.trim();
      }

      return 'Desculpe, não consegui gerar uma resposta no momento.';
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[GeminiLLMClient] Erro ao chamar Gemini API:', errorMsg);
      return `⚠️ Ocorreu um erro ao consultar o Gemini: ${errorMsg}`;
    }
  }
}
