import pg from 'pg';
import { Message, MessageRole } from '../../../../core/domain/entities/Message.js';
import { MessageRepositoryPort } from '../../../../core/application/ports/out/MessageRepositoryPort.js';

export class PostgresMessageRepository implements MessageRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async saveMessage(conversationId: string, role: MessageRole, content: string): Promise<Message> {
    const query = `
      INSERT INTO messages (conversation_id, role, content)
      VALUES ($1, $2, $3)
      RETURNING id, conversation_id, role, content, created_at;
    `;
    const res = await this.pool.query(query, [conversationId, role, content]);
    const row = res.rows[0];

    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageRole,
      content: row.content,
      createdAt: new Date(row.created_at),
    };
  }

  async getRecentMessages(conversationId: string, limit: number = 10): Promise<Message[]> {
    const query = `
      SELECT id, conversation_id, role, content, created_at
      FROM (
        SELECT id, conversation_id, role, content, created_at
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      ) sub
      ORDER BY created_at ASC;
    `;
    const res = await this.pool.query(query, [conversationId, limit]);
    return res.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageRole,
      content: row.content,
      createdAt: new Date(row.created_at),
    }));
  }
}
