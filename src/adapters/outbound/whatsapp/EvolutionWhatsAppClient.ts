import { WhatsAppNotifierPort } from '../../../core/application/ports/out/WhatsAppNotifierPort.js';
import { alternateBrazilianNumber, maskPhone } from '../../../core/domain/entities/User.js';

export interface EvolutionClientConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  /** Tempo máximo de cada requisição, em ms (padrão 15000). */
  requestTimeoutMs?: number;
  /** Esperas entre novas tentativas em falha de rede, em ms (padrão [500, 1500]). */
  retryDelaysMs?: number[];
}

interface SendAttempt {
  ok: boolean;
  status: number;
  body: string;
  /** A Evolution informou que o número não existe no WhatsApp. */
  numberNotFound: boolean;
}

// Falhas em que a conexão caiu ou nem chegou a ser feita: vale repetir.
// Timeout NÃO entra: a Evolution pode ter aceitado a mensagem e repetir duplicaria o envio.
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** O `fetch` do Node esconde a causa real em `err.cause` (ou em um AggregateError). */
function networkErrorCode(err: unknown): string | undefined {
  const e = err as any;
  return e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.code;
}

function describeNetworkError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = networkErrorCode(err);
  return code ? `${message} [${code}]` : message;
}

function isRetryableNetworkError(err: unknown): boolean {
  const code = networkErrorCode(err);
  return code !== undefined && RETRYABLE_NETWORK_CODES.has(code);
}

export class EvolutionWhatsAppClient implements WhatsAppNotifierPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;
  private readonly requestTimeoutMs: number;
  private readonly retryDelaysMs: number[];

  constructor(config: EvolutionClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.instanceName = config.instanceName;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
    this.retryDelaysMs = config.retryDelaysMs ?? [500, 1500];
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
      console.error(`[EvolutionClient] Falha de rede ao enviar mensagem para ${label}: ${describeNetworkError(err)}`);
      return false;
    }
  }

  private async post(number: string, text: string): Promise<SendAttempt> {
    const response = await this.fetchWithRetry(number, text);

    if (response.ok) return { ok: true, status: response.status, body: '', numberNotFound: false };

    const body = await response.text();
    return {
      ok: false,
      status: response.status,
      body,
      numberNotFound: response.status === 400 && this.isNumberNotFound(body),
    };
  }

  private async fetchWithRetry(number: string, text: string): Promise<Response> {
    const attempts = this.retryDelaysMs.length + 1;
    let lastErr: unknown;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fetch(`${this.baseUrl}/message/sendText/${this.instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
          body: JSON.stringify({ number, text }),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (err: unknown) {
        lastErr = err;
        if (!isRetryableNetworkError(err) || i === attempts - 1) break;
        const wait = this.retryDelaysMs[i];
        console.warn(
          `[EvolutionClient] Falha de rede (${describeNetworkError(err)}); nova tentativa ${i + 2}/${attempts} em ${wait}ms.`
        );
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw lastErr;
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
