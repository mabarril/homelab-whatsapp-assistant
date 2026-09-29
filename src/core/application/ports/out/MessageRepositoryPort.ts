import { Message, MessageRole } from '../../../domain/entities/Message.js';

export interface MessageRepositoryPort {
  saveMessage(conversationId: string, role: MessageRole, content: string): Promise<Message>;
  getRecentMessages(conversationId: string, limit?: number): Promise<Message[]>;
}
