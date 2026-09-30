export const MESSAGE_EVENTS = ['messages.upsert', 'messages-upsert', 'MESSAGES_UPSERT'];

/** Subconjunto da fila BullMQ usado aqui (facilita testar com um dublê). */
export interface QueueLike {
  getJob(jobId: string): Promise<unknown | undefined | null>;
  add(name: string, data: unknown, opts: Record<string, unknown>): Promise<unknown>;
}

export type EnqueueOutcome =
  | { status: 'enqueued'; jobId?: string }
  | { status: 'duplicate'; jobId: string }
  | { status: 'ignored'; event: string };

/**
 * Decide o destino de um evento da Evolution e registra em log o que foi feito,
 * para que o webhook nunca "engula" um evento sem deixar rastro.
 *
 * O jobId deriva do id da mensagem: a Evolution pode reentregar o mesmo evento
 * e o BullMQ mantém jobs concluídos por 1 h, então repetições são descartadas.
 */
export async function enqueueIncomingEvent(queue: QueueLike, payload: any): Promise<EnqueueOutcome> {
  const eventType = String(payload?.event ?? 'unknown');

  if (!MESSAGE_EVENTS.includes(eventType)) {
    console.log(`[Webhook] Evento "${eventType}" ignorado (não é mensagem nova).`);
    return { status: 'ignored', event: eventType };
  }

  const messageId = payload?.data?.key?.id;
  const jobId = typeof messageId === 'string' && messageId ? `msg-${messageId}` : undefined;

  if (jobId && (await queue.getJob(jobId))) {
    console.warn(
      `[Webhook] ♻️ Evento duplicado descartado (job ${jobId} já existe na fila ou foi concluído há menos de 1 h).`
    );
    return { status: 'duplicate', jobId };
  }

  await queue.add('evolution-message', payload, {
    jobId,
    removeOnComplete: { age: 3600 },
    removeOnFail: 100,
  });
  console.log(`[Webhook] 📥 Mensagem enfileirada (job ${jobId ?? 'sem id'}).`);
  return { status: 'enqueued', jobId };
}
