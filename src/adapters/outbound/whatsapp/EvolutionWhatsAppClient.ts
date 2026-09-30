import { WhatsAppNotifierPort } from '../../../core/application/ports/out/WhatsAppNotifierPort.js';
import { alternateBrazilianNumber, maskPhone } from '../../../core/domain/entities/User.js';

export interface EvolutionClientConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

interface SendAttempt {
  ok: boolean;
  status: number;
  body: string;
  /** A Evolution informou que o número não existe no WhatsApp. */
  numberNotFound: boolean;
}

export class EvolutionWhatsAppClient implements WhatsAppNotifierPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;

  constructor(config: EvolutionClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.instanceName = config.instanceName;
  }

  async sendTextMessage(to: string, text: string): Promise<boolean> {
    const label = maskPhone(to);

    try {
      let attempt = await this.post(to, text);

      // Números BR: o WhatsApp pode conhecer o contato com ou sem o 9º dígito.
      // Se o formato recebido "não existe", tenta a outra variante uma vez.
      if (!attempt.ok && attempt.numberNotFound && to.endsWith('@s.whatsapp.net')) {
        const alternative = alternateBrazilianNumber(to);
        if (alternative) {
          console.warn(`[EvolutionClient] Número ${label} não encontrado; tentando variante com/sem 9º dígito.`);
          attempt = await this.post(alternative, text);
        }
      }

      if (!attempt.ok) {
        console.error(
          `[EvolutionClient] Erro ao enviar mensagem para ${label} (Status ${attempt.status}):`,
          attempt.body
        );
        return false;
      }

      console.log(`[EvolutionClient] ✅ Mensagem enviada com sucesso para ${label}`);
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[EvolutionClient] Falha de rede ao enviar mensagem para ${label}:`, errorMsg);
      return false;
    }
  }

  private async post(number: string, text: string): Promise<SendAttempt> {
    const response = await fetch(`${this.baseUrl}/message/sendText/${this.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ number, text }),
    });

    if (response.ok) return { ok: true, status: response.status, body: '', numberNotFound: false };

    const body = await response.text();
    return { ok: false, status: response.status, body, numberNotFound: response.status === 400 && this.isNumberNotFound(body) };
  }

  private isNumberNotFound(body: string): boolean {
    try {
      const messages = JSON.parse(body)?.response?.message;
      if (Array.isArray(messages)) return messages.some((m: any) => m?.exists === false);
    } catch {
      // corpo não é JSON: cai na checagem textual
    }
    return /"exists"\s*:\s*false/.test(body);
  }
}
