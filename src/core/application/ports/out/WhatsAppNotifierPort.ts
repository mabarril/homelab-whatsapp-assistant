export interface WhatsAppNotifierPort {
  sendTextMessage(to: string, text: string): Promise<boolean>;
}
