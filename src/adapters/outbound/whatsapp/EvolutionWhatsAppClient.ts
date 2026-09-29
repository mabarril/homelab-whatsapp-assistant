import { WhatsAppNotifierPort } from '../../../core/application/ports/out/WhatsAppNotifierPort.js';

export interface EvolutionClientConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
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
    const endpoint = `${this.baseUrl}/message/sendText/${this.instanceName}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        body: JSON.stringify({
          number: to,
          text: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EvolutionClient] Erro ao enviar mensagem para ${to} (Status ${response.status}):`, errorText);
        return false;
      }

      console.log(`[EvolutionClient] ✅ Mensagem enviada com sucesso para ${to}`);
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[EvolutionClient] Falha de rede ao enviar mensagem para ${to}:`, errorMsg);
      return false;
    }
  }
}
