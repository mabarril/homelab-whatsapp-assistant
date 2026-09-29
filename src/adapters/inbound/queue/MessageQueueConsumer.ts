import { Worker, Job } from 'bullmq';
import { ProcessIncomingMessage } from '../../../core/application/use-cases/ProcessIncomingMessage.js';

export function extractMessageContent(payload: any): {
  remoteJid: string;
  senderName: string;
  messageText: string;
  fromMe: boolean;
} | null {
  if (!payload) return null;

  // Evolution API v2 pode enviar o objeto em payload.data ou payload direto
  const messageData = payload.data || payload;
  const key = messageData.key;
  if (!key || !key.remoteJid) return null;

  // Ignora mensagens de status/stories do WhatsApp
  if (key.remoteJid.includes('status@broadcast')) return null;

  const fromMe = Boolean(key.fromMe);
  const remoteJid = key.remoteJid;
  const senderName = messageData.pushName || 'Usuário';

  const msg = messageData.message || {};
  let messageText = '';

  if (typeof msg.conversation === 'string') {
    messageText = msg.conversation;
  } else if (msg.extendedTextMessage && typeof msg.extendedTextMessage.text === 'string') {
    messageText = msg.extendedTextMessage.text;
  } else if (msg.imageMessage && typeof msg.imageMessage.caption === 'string') {
    messageText = msg.imageMessage.caption;
  } else if (msg.videoMessage && typeof msg.videoMessage.caption === 'string') {
    messageText = msg.videoMessage.caption;
  } else if (msg.documentMessage && typeof msg.documentMessage.caption === 'string') {
    messageText = msg.documentMessage.caption;
  }

  return {
    remoteJid,
    senderName,
    messageText: messageText.trim(),
    fromMe,
  };
}

export function createMessageQueueWorker(
  queueName: string,
  redisConnectionConfig: any,
  processUseCase: ProcessIncomingMessage
): Worker {
  const worker = new Worker(
    queueName,
    async (job: Job) => {
      console.log(`[Queue Worker] Processando job ${job.id} (${job.name})`);

      const eventPayload = job.data;
      const extracted = extractMessageContent(eventPayload);

      if (!extracted) {
        console.log(`[Queue Worker] Payload sem formato de mensagem válido. Ignorando.`);
        return;
      }

      await processUseCase.execute(extracted);
    },
    {
      connection: redisConnectionConfig,
    }
  );

  worker.on('failed', (job: any, err: any) => {
    console.error(`[Queue Worker] ❌ Falha no job ${job?.id}:`, err?.message || String(err));
  });

  return worker;
}
