import { UserRepositoryPort } from '../ports/out/UserRepositoryPort.js';
import { MessageRepositoryPort } from '../ports/out/MessageRepositoryPort.js';
import { PrintRepositoryPort } from '../ports/out/PrintRepositoryPort.js';
import { WhatsAppNotifierPort } from '../ports/out/WhatsAppNotifierPort.js';
import { LLMServicePort } from '../ports/out/LLMServicePort.js';
import { calculate3dPrintCost } from './Calculate3dPrintCost.js';
import { normalizePhoneNumber } from '../../domain/entities/User.js';

export interface ProcessIncomingMessageDTO {
  remoteJid: string;
  senderName: string;
  messageText: string;
  fromMe: boolean;
}

export class ProcessIncomingMessage {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly messageRepository: MessageRepositoryPort,
    private readonly printRepository: PrintRepositoryPort,
    private readonly whatsAppNotifier: WhatsAppNotifierPort,
    private readonly llmService: LLMServicePort,
    private readonly adminPhoneNumber: string = '5561981306655'
  ) {}

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

    const phoneNumber = normalizePhoneNumber(remoteJid);
    console.log(`[ProcessIncomingMessage] Processando mensagem de ${senderName} (${phoneNumber}): "${messageText}"`);

    // 3. Localiza ou cadastra o usuário
    let user = await this.userRepository.findByPhoneNumber(phoneNumber);
    if (!user) {
      const isAdmin = phoneNumber === this.adminPhoneNumber;
      user = await this.userRepository.create({
        phoneNumber,
        name: senderName || 'Amigo do Homelab',
        role: isAdmin ? 'ADMIN' : 'MEMBER',
      });
      console.log(`[ProcessIncomingMessage] Novo usuário registrado: ${user.name} (${user.role})`);
    }

    // 4. Obtém conversa ativa
    const conversationId = await this.userRepository.getOrCreateActiveConversation(user.id);

    // 5. Histórico e configurações de impressão
    const history = await this.messageRepository.getRecentMessages(conversationId, 10);
    const printSettings = await this.printRepository.getSettings(user.id);

    // 6. Salva a mensagem recebida no banco
    await this.messageRepository.saveMessage(conversationId, 'user', messageText);

    // 7. Processa com o LLM (Gemini) e executa ferramentas se necessário
    const replyText = await this.llmService.generateResponse({
      user,
      conversationHistory: history,
      currentMessage: messageText,
      printSettings,
      onExecutePrintCalculation: async (calcData) => {
        const calculated = calculate3dPrintCost({
          userId: user.id,
          projectName: calcData.projectName,
          weightGrams: calcData.weightGrams,
          printTimeHours: calcData.printTimeHours,
          settings: printSettings,
        });
        const saved = await this.printRepository.saveCalculation(calculated);
        console.log(`[ProcessIncomingMessage] 🖨️ Novo cálculo de impressão salvo: ${saved.projectName} - R$ ${saved.totalCost}`);
        return saved;
      },
      onUpdatePrintSettings: async (updateData) => {
        const updated = await this.printRepository.updateSettings(user.id, updateData);
        console.log(`[ProcessIncomingMessage] ⚙️ Configurações de impressão atualizadas para ${user.name}`);
        return updated;
      },
    });

    // 8. Salva a resposta no banco
    await this.messageRepository.saveMessage(conversationId, 'model', replyText);

    // 9. Envia a resposta de volta pelo WhatsApp
    await this.whatsAppNotifier.sendTextMessage(remoteJid, replyText);
  }
}
