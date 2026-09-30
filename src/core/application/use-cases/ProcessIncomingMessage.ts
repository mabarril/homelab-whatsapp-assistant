import { UserRepositoryPort } from '../ports/out/UserRepositoryPort.js';
import { MessageRepositoryPort } from '../ports/out/MessageRepositoryPort.js';
import { PrintRepositoryPort } from '../ports/out/PrintRepositoryPort.js';
import { WhatsAppNotifierPort } from '../ports/out/WhatsAppNotifierPort.js';
import { LLMServicePort, LLMUnavailableError } from '../ports/out/LLMServicePort.js';
import { calculate3dPrintCost } from './Calculate3dPrintCost.js';
import { maskPhone, normalizePhoneNumber, phoneMatchKey } from '../../domain/entities/User.js';

export interface ProcessIncomingMessageDTO {
  remoteJid: string;
  senderName: string;
  messageText: string;
  fromMe: boolean;
}

const LLM_FAILURE_REPLY =
  '⚠️ Tive um problema para processar sua mensagem agora. Tente novamente em instantes.';

export class ProcessIncomingMessage {
  private readonly adminKey: string;
  private readonly allowedKeys: Set<string>;

  /**
   * @param adminPhoneNumber número do administrador (sempre autorizado)
   * @param allowedPhoneNumbers demais números autorizados a falar com o assistente
   */
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly messageRepository: MessageRepositoryPort,
    private readonly printRepository: PrintRepositoryPort,
    private readonly whatsAppNotifier: WhatsAppNotifierPort,
    private readonly llmService: LLMServicePort,
    adminPhoneNumber: string,
    allowedPhoneNumbers: readonly string[] = []
  ) {
    if (!phoneMatchKey(adminPhoneNumber)) {
      throw new Error('ADMIN_PHONE_NUMBER inválido: informe apenas dígitos com DDI e DDD.');
    }
    this.adminKey = phoneMatchKey(adminPhoneNumber);
    this.allowedKeys = new Set(
      [adminPhoneNumber, ...allowedPhoneNumbers].map(phoneMatchKey).filter((k) => k.length > 0)
    );
  }

  private isAdmin(phoneNumber: string): boolean {
    return phoneMatchKey(phoneNumber) === this.adminKey;
  }

  private isAllowed(phoneNumber: string): boolean {
    return this.allowedKeys.has(phoneMatchKey(phoneNumber));
  }

  async execute(dto: ProcessIncomingMessageDTO): Promise<void> {
    const { remoteJid, senderName, messageText, fromMe } = dto;

    // 1. Ignora mensagens enviadas pelo próprio bot para evitar loops
    if (fromMe) {
      console.log(`[ProcessIncomingMessage] Mensagem ignorada (enviada pelo próprio bot).`);
      return;
    }

    // 2. Ignora mensagens vazias ou de mídia não suportada
    if (!messageText || messageText.trim().length === 0) {
      console.log(`[ProcessIncomingMessage] Mensagem vazia ou sem texto ignorada.`);
      return;
    }

    // 3. Controle de acesso: só números autorizados são atendidos ou cadastrados.
    //    Grupos nunca são atendidos.
    const phoneNumber = normalizePhoneNumber(remoteJid);
    if (remoteJid.endsWith('@g.us') || !this.isAllowed(phoneNumber)) {
      const jidKind = remoteJid.includes('@') ? remoteJid.split('@')[1] : 'desconhecido';
      console.warn(
        `[ProcessIncomingMessage] 🚫 Remetente não autorizado ignorado (${maskPhone(phoneNumber)}, tipo ${jidKind}).`
      );
      return;
    }

    // Não registra o conteúdo da mensagem nos logs (dados pessoais).
    console.log(
      `[ProcessIncomingMessage] Processando mensagem de ${maskPhone(phoneNumber)} (${messageText.length} caracteres).`
    );

    // 4. Localiza ou cadastra o usuário
    let user = await this.userRepository.findByPhoneNumber(phoneNumber);
    if (!user) {
      user = await this.userRepository.create({
        phoneNumber,
        name: senderName || 'Amigo do Homelab',
        role: this.isAdmin(phoneNumber) ? 'ADMIN' : 'MEMBER',
      });
      console.log(
        `[ProcessIncomingMessage] Novo usuário registrado: ${maskPhone(phoneNumber)} (${user.role})`
      );
    }
    const currentUser = user;

    // 5. Obtém conversa ativa
    const conversationId = await this.userRepository.getOrCreateActiveConversation(currentUser.id);

    // 6. Histórico e configurações de impressão
    const history = await this.messageRepository.getRecentMessages(conversationId, 10);
    const printSettings = await this.printRepository.getSettings(currentUser.id);

    // 7. Salva a mensagem recebida no banco
    await this.messageRepository.saveMessage(conversationId, 'user', messageText);

    // 8. Processa com o LLM (Gemini) e executa ferramentas se necessário
    let replyText: string;
    try {
      replyText = await this.llmService.generateResponse({
        user: currentUser,
        conversationHistory: history,
        currentMessage: messageText,
        printSettings,
        onExecutePrintCalculation: async (calcData) => {
          // Lê as configurações no momento do cálculo: uma atualização feita
          // antes, no mesmo turno, precisa ser respeitada.
          const settings = await this.printRepository.getSettings(currentUser.id);
          const calculated = calculate3dPrintCost({
            userId: currentUser.id,
            projectName: calcData.projectName,
            weightGrams: calcData.weightGrams,
            printTimeHours: calcData.printTimeHours,
            settings,
          });
          const saved = await this.printRepository.saveCalculation(calculated);
          console.log(
            `[ProcessIncomingMessage] 🖨️ Novo cálculo de impressão salvo: ${saved.projectName} - R$ ${saved.totalCost}`
          );
          return { calculation: saved, settings };
        },
        onUpdatePrintSettings: async (updateData) => {
          const updated = await this.printRepository.updateSettings(currentUser.id, updateData);
          console.log(`[ProcessIncomingMessage] ⚙️ Configurações de impressão atualizadas.`);
          return updated;
        },
        onGetPrintSettings: () => this.printRepository.getSettings(currentUser.id),
      });
    } catch (err: unknown) {
      if (err instanceof LLMUnavailableError) {
        // Detalhes técnicos ficam só no log: nada de erro cru para o usuário
        // nem resposta falsa gravada no histórico da conversa.
        console.error('[ProcessIncomingMessage] Falha no LLM:', err.message);
        await this.whatsAppNotifier.sendTextMessage(remoteJid, LLM_FAILURE_REPLY);
        return;
      }
      throw err;
    }

    // 9. Salva a resposta no banco
    await this.messageRepository.saveMessage(conversationId, 'model', replyText);

    // 10. Envia a resposta de volta pelo WhatsApp
    await this.whatsAppNotifier.sendTextMessage(remoteJid, replyText);
  }
}
