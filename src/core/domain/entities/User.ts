export type UserRole = 'ADMIN' | 'MEMBER';

export interface User {
  id: string;
  phoneNumber: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export function normalizePhoneNumber(phone: string): string {
  // Remove sufixos como @s.whatsapp.net ou :device e caracteres não numéricos
  const clean = phone.split('@')[0].split(':')[0];
  return clean.replace(/\D/g, '');
}
