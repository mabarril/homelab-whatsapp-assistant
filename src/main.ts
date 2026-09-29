import http from 'node:http';
import pg from 'pg';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { z } from 'zod';

import { PostgresUserRepository } from './adapters/outbound/persistence/postgres/PostgresUserRepository.js';
import { PostgresMessageRepository } from './adapters/outbound/persistence/postgres/PostgresMessageRepository.js';
import { PostgresPrintRepository } from './adapters/outbound/persistence/postgres/PostgresPrintRepository.js';
import { EvolutionWhatsAppClient } from './adapters/outbound/whatsapp/EvolutionWhatsAppClient.js';
import { GeminiLLMClient } from './adapters/outbound/llm/GeminiLLMClient.js';
import { ProcessIncomingMessage } from './core/application/use-cases/ProcessIncomingMessage.js';
import { createMessageQueueWorker } from './adapters/inbound/queue/MessageQueueConsumer.js';

// Schema de validação das variáveis de ambiente
const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.string().default('6379'),
  EVOLUTION_BASE_URL: z.string().default('http://evolution-api:8080'),
  EVOLUTION_API_KEY: z.string().optional().default(''),
  EVOLUTION_INSTANCE_NAME: z.string().default('homelab_family'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY é obrigatória para o assistente funcionar'),
  ADMIN_PHONE_NUMBER: z.string().default('5561981306655'),
});

const env = envSchema.parse({
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
  EVOLUTION_BASE_URL: process.env.EVOLUTION_BASE_URL,
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ADMIN_PHONE_NUMBER: process.env.ADMIN_PHONE_NUMBER || '5561981306655',
});

const port = parseInt(env.PORT, 10);
const redisPort = parseInt(env.REDIS_PORT, 10);

// 1. Configuração do PostgreSQL Pool
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

// 2. Configuração do Redis
const redisConnectionConfig = {
  host: env.REDIS_HOST,
  port: redisPort,
  maxRetriesPerRequest: null,
};

const redis = new Redis({
  host: env.REDIS_HOST,
  port: redisPort,
});

// 3. Fila BullMQ para mensagens e eventos do WhatsApp
const QUEUE_NAME = 'whatsapp-messages';
const messageQueue = new Queue(QUEUE_NAME, {
  connection: redisConnectionConfig,
});

// 4. Instanciação dos Repositórios e Clientes
const userRepository = new PostgresUserRepository(pool);
const messageRepository = new PostgresMessageRepository(pool);
const printRepository = new PostgresPrintRepository(pool);

const whatsAppClient = new EvolutionWhatsAppClient({
  baseUrl: env.EVOLUTION_BASE_URL,
  apiKey: env.EVOLUTION_API_KEY,
  instanceName: env.EVOLUTION_INSTANCE_NAME,
});

const llmClient = new GeminiLLMClient(env.GEMINI_API_KEY);

// 5. Instanciação do Caso de Uso Principal
const processIncomingMessage = new ProcessIncomingMessage(
  userRepository,
  messageRepository,
  printRepository,
  whatsAppClient,
  llmClient,
  env.ADMIN_PHONE_NUMBER
);

// 6. Worker para consumo assíncrono das mensagens
const messageWorker = createMessageQueueWorker(
  QUEUE_NAME,
  redisConnectionConfig,
  processIncomingMessage
);

// 7. Servidor HTTP Nativo para Healthcheck e Webhook da Evolution API
const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Rota de Healthcheck
  if (method === 'GET' && (url === '/health' || url === '/')) {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    try {
      const pong = await redis.ping();
      if (pong === 'PONG') redisStatus = 'connected';
    } catch {
      redisStatus = 'error';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: dbStatus === 'connected' && redisStatus === 'connected' ? 'ok' : 'degraded',
        service: 'homelab-whatsapp-assistant',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        connections: {
          database: dbStatus,
          redis: redisStatus,
        },
      })
    );
    return;
  }

  // Rota de Webhook da Evolution API
  if (method === 'POST' && url === '/webhook') {
    let rawBody = '';

    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(rawBody || '{}');
        const eventType = payload.event || 'unknown';
        console.log(`[Webhook] Evento recebido da Evolution API: ${eventType}`);

        // Apenas enfileira eventos de mensagem nova
        if (eventType === 'messages.upsert' || eventType === 'messages-upsert' || !payload.event) {
          await messageQueue.add('evolution-message', payload, {
            removeOnComplete: true,
            removeOnFail: 100,
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, event: eventType }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Webhook] Erro ao ler payload:', errorMsg);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Inicialização do serviço
async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🤖 Homelab WhatsApp Assistant iniciando...');
  console.log('----------------------------------------------------');

  try {
    // 1. Testa PostgreSQL
    const dbTest = await pool.query('SELECT NOW() as now, COUNT(*) as user_count FROM users;');
    const userCount = dbTest.rows[0]?.user_count ?? 0;
    console.log(`✅ Banco PostgreSQL conectado! Usuários cadastrados: ${userCount}`);

    // 2. Testa Redis
    const pong = await redis.ping();
    console.log(`✅ Redis conectado com sucesso! Resposta: ${pong}`);

    // 3. Inicia o servidor HTTP
    server.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Servidor HTTP ouvindo na porta ${port}`);
      console.log(`🩺 Healthcheck: http://localhost:${port}/health`);
      console.log(`📡 Webhook URL para Evolution API: http://core-assistant:${port}/webhook`);
      console.log(`👑 Administrador padrão: ${env.ADMIN_PHONE_NUMBER}`);
      console.log('----------------------------------------------------');
      console.log('💬 Pronto para receber mensagens do WhatsApp!');
      console.log('----------------------------------------------------');
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Falha na inicialização do Core Assistant:', errorMsg);
    process.exit(1);
  }
}

// Tratamento de shutdown gracioso
async function gracefulShutdown(signal: string) {
  console.log(`\n[Shutdown] Recebido sinal ${signal}. Encerrando conexões com segurança...`);
  server.close();
  try {
    await messageWorker.close();
    await messageQueue.close();
    await redis.quit();
    await pool.end();
    console.log('[Shutdown] Conexões finalizadas com sucesso.');
  } catch (err) {
    console.error('[Shutdown] Erro ao fechar conexões:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

bootstrap();
