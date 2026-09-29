export type MessageRole = 'user' | 'model';

export interface Message {
  id?: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt?: Date;
}
