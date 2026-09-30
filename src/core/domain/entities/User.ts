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

/**
 * Chave para comparar números brasileiros com e sem o 9º dígito
 * (o WhatsApp ainda entrega JIDs antigos no formato 55 + DDD + 8 dígitos).
 */
export function phoneMatchKey(phone: string): string {
  const digits = normalizePhoneNumber(phone);
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    return digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

/** Mascara o número para logs (ex.: ***6655). */
export function maskPhone(phone: string): string {
  const digits = normalizePhoneNumber(phone);
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
}
