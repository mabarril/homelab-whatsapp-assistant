import pg from 'pg';
import { User, UserRole, normalizePhoneNumber } from '../../../../core/domain/entities/User.js';
import { CreateUserData, UserRepositoryPort } from '../../../../core/application/ports/out/UserRepositoryPort.js';

export class PostgresUserRepository implements UserRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const normalized = normalizePhoneNumber(phoneNumber);
    const query = `
      SELECT id, phone_number, name, role, created_at
      FROM users
      WHERE phone_number = $1
      LIMIT 1;
    `;
    const res = await this.pool.query(query, [normalized]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      phoneNumber: row.phone_number,
      name: row.name,
      role: row.role as UserRole,
      createdAt: new Date(row.created_at),
    };
  }

  async findById(id: string): Promise<User | null> {
    const query = `
      SELECT id, phone_number, name, role, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;
    const res = await this.pool.query(query, [id]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      phoneNumber: row.phone_number,
      name: row.name,
      role: row.role as UserRole,
      createdAt: new Date(row.created_at),
    };
  }

  async create(data: CreateUserData): Promise<User> {
    const normalized = normalizePhoneNumber(data.phoneNumber);
    const role = data.role || 'MEMBER';

    const query = `
      INSERT INTO users (phone_number, name, role)
      VALUES ($1, $2, $3)
      RETURNING id, phone_number, name, role, created_at;
    `;
    const res = await this.pool.query(query, [normalized, data.name, role]);
    const row = res.rows[0];

    // Cria as configurações padrão de impressão para o novo usuário
    await this.pool.query(
      `INSERT INTO print_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING;`,
      [row.id]
    );

    return {
      id: row.id,
      phoneNumber: row.phone_number,
      name: row.name,
      role: row.role as UserRole,
      createdAt: new Date(row.created_at),
    };
  }

  async getOrCreateActiveConversation(userId: string): Promise<string> {
    // Busca conversa ativa existente
    const findQuery = `
      SELECT id
      FROM conversations
      WHERE user_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const findRes = await this.pool.query(findQuery, [userId]);
    if (findRes.rows.length > 0) {
      return findRes.rows[0].id;
    }

    // Cria nova conversa se não houver
    const insertQuery = `
      INSERT INTO conversations (user_id, is_active)
      VALUES ($1, TRUE)
      RETURNING id;
    `;
    const insertRes = await this.pool.query(insertQuery, [userId]);
    return insertRes.rows[0].id;
  }
}
