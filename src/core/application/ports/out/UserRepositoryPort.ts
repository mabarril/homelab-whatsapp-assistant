import { User, UserRole } from '../../../domain/entities/User.js';

export interface CreateUserData {
  phoneNumber: string;
  name: string;
  role?: UserRole;
}

export interface UserRepositoryPort {
  findByPhoneNumber(phoneNumber: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  getOrCreateActiveConversation(userId: string): Promise<string>;
}
