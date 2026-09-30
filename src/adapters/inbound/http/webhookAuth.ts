import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const WEBHOOK_TOKEN_HEADER = 'x-webhook-token';

/**
 * Valida o token do webhook em tempo constante.
 * Os dois valores passam por SHA-256 antes da comparação para igualar o
 * tamanho dos buffers (timingSafeEqual exige tamanhos iguais).
 */
export function isWebhookAuthorized(headers: IncomingHttpHeaders, expectedToken: string): boolean {
  const provided = headers[WEBHOOK_TOKEN_HEADER];
  if (typeof provided !== 'string' || provided.length === 0 || expectedToken.length === 0) {
    return false;
  }
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(a, b);
}
