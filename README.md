# Homelab WhatsApp Assistant 🤖

Assistente inteligente para WhatsApp auto-hospedado (Homelab), desenvolvido em **Node.js / TypeScript**, com arquitetura limpa (Hexagonal / Clean Architecture), persistência em **PostgreSQL (pgvector)**, filas assíncronas com **Redis + BullMQ**, mensageria via **Evolution API v2** e inteligência artificial alimentada pelo **Google Gemini**.

---

## 🛠️ Tecnologias Utilizadas

- **Runtime & Linguagem:** Node.js (ESModules) & TypeScript
- **Mensageria WhatsApp:** [Evolution API v2](https://github.com/EvolutionAPI/evolution-api)
- **Inteligência Artificial:** Google Gemini API (`@google/genai`)
- **Banco de Dados:** PostgreSQL 16 com extensão `pgvector`
- **Fila & Cache:** Redis 7 com [BullMQ](https://github.com/taskforcesh/bullmq)
- **Infraestrutura:** Docker & Docker Compose

---

## 📁 Arquitetura do Projeto

O projeto segue os princípios de **Clean Architecture / Ports & Adapters**:

```text
src/
├── core/
│   ├── domain/               # Entidades de negócio (User, Message, PrintCalculation)
│   └── application/
│       ├── ports/            # Portas de entrada e saída (interfaces)
│       └── use-cases/        # Casos de uso (ProcessIncomingMessage, Calculate3dPrintCost)
├── adapters/
│   ├── inbound/              # Adaptadores de entrada (Fila BullMQ, Webhook HTTP)
│   └── outbound/             # Adaptadores de saída (Postgres, Redis, Evolution API, Gemini)
└── main.ts                   # Ponto de entrada, injeção de dependências e servidor HTTP
```

---

## 🚀 Como Executar

### 1. Pré-requisitos

- [Docker](https://docs.docker.com/engine/install/) e [Docker Compose](https://docs.docker.com/compose/) instalados.
- Chave de API do [Google AI Studio (Gemini)](https://aistudio.google.com/).

### 2. Configurar Variáveis de Ambiente

Copie o arquivo de exemplo `.env.example` para `.env`:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=sua_senha_segura
POSTGRES_DB=homelab_assistant
EVOLUTION_API_KEY=sua_evolution_api_key_secreta
GEMINI_API_KEY=sua_chave_do_google_gemini
GEMINI_MODEL=gemini-3.8-flash
ADMIN_PHONE_NUMBER=5561999999999
ALLOWED_PHONE_NUMBERS=5561888888888,5561777777777
WEBHOOK_TOKEN=cole_aqui_a_saida_de_openssl_rand_hex_32
```

- `GEMINI_MODEL` é opcional. Modelos antigos são desativados pela Google (o `gemini-2.5-flash` já não atende contas novas), então troque por aqui, sem mexer no código.
- `ADMIN_PHONE_NUMBER` e `WEBHOOK_TOKEN` são **obrigatórios** (o app não sobe sem eles).
- Apenas o admin e os números de `ALLOWED_PHONE_NUMBERS` são atendidos; qualquer outro remetente é ignorado.
- As portas `3000` e `8080` são publicadas somente em `127.0.0.1`. Para acesso externo, use um reverse proxy com TLS.

### 3. Iniciar a Stack com Docker

```bash
docker compose up -d --build
```

Verifique a saúde da aplicação:

```bash
curl http://localhost:3000/health
```

---

## 📱 Conectando o WhatsApp (Evolution API)

Após subir os containers, a **Evolution API** estará disponível na porta `8080`.

### 1. Criar a instância

```bash
curl -X POST http://localhost:8080/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -d '{
    "instanceName": "homelab_family",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

### 2. Escanear o QR Code

Acesse a URL abaixo no seu navegador e escaneie o QR Code com o aplicativo do WhatsApp:

```text
http://localhost:8080/instance/connect/homelab_family
```

### 3. Configurar o Webhook

O webhook exige o header `x-webhook-token` (mesmo valor de `WEBHOOK_TOKEN`); sem ele, o assistente responde `401`.

Configure o webhook para encaminhar as mensagens recebidas ao container `core-assistant`:

```bash
curl -X POST http://localhost:8080/webhook/set/homelab_family \
  -H "Content-Type: application/json" \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "http://core-assistant:3000/webhook",
      "headers": {
        "x-webhook-token": "SEU_WEBHOOK_TOKEN",
        "Content-Type": "application/json"
      },
      "byEvents": false,
      "base64": false,
      "events": [
        "MESSAGES_UPSERT"
      ]
    }
  }'
```

---

## 📊 Funcionalidades

- **Processamento Assíncrono:** Mensagens recebidas no webhook são imediatamente enfileiradas no Redis/BullMQ, garantindo alta disponibilidade e resposta rápida sem bloquear a Evolution API.
- **Memória de Conversa:** Histórico de mensagens recente por conversa armazenado no PostgreSQL.
- **Calculadora de Impressão 3D:** Cálculo automatizado de custos de filamento, energia, depreciação da impressora e margens de lucro de 30%, 50% e 100%.
- **Atendimento com IA:** Integração com Gemini com prompt contextualizado e personas por usuário/nível de acesso (Admin / Membro).

---

## 📄 Licença

Este projeto é disponibilizado sob a licença [MIT](LICENSE).
