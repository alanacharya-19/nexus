import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapMessage } from '../db/mappers.js';
import type {
  ConversationMessage,
  MessageMetadata,
  MessageRole,
} from '@nexus/shared';

export async function createMessage(input: {
  conversationId: string;
  userId: string;
  role: MessageRole;
  content?: string;
  metadata?: MessageMetadata;
}): Promise<ConversationMessage> {
  const result = await query(
    `INSERT INTO messages (id, conversation_id, user_id, role, content, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      randomUUID(),
      input.conversationId,
      input.userId,
      input.role,
      input.content ?? '',
      JSON.stringify(input.metadata ?? { status: 'complete' }),
    ]
  );
  return mapMessage(result.rows[0]!);
}

/** Ownership is enforced by joining the conversation, never by trusting the URL. */
export async function listMessages(
  userId: string,
  conversationId: string,
  options: { limit?: number; after?: string } = {}
): Promise<ConversationMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1_000);
  const values: unknown[] = [userId, conversationId];
  let afterClause = '';
  if (options.after) {
    afterClause = 'AND m.created_at > $3';
    values.push(options.after);
  }
  values.push(limit);
  const result = await query(
    `SELECT m.*
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND m.conversation_id = $2 ${afterClause}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT $${values.length}`,
    values
  );
  return result.rows.map(mapMessage);
}

export async function getMessage(
  userId: string,
  conversationId: string,
  messageId: string
): Promise<ConversationMessage | null> {
  const result = await query(
    `SELECT m.*
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND m.conversation_id = $2 AND m.id = $3`,
    [userId, conversationId, messageId]
  );
  const row = result.rows[0];
  return row ? mapMessage(row) : null;
}

/** Internal lookup used by the streaming worker after ownership is established. */
export async function getMessageInternal(
  messageId: string
): Promise<ConversationMessage | null> {
  const result = await query('SELECT * FROM messages WHERE id = $1', [messageId]);
  const row = result.rows[0];
  return row ? mapMessage(row) : null;
}

export async function updateMessage(
  messageId: string,
  patch: { content?: string; metadata?: MessageMetadata }
): Promise<ConversationMessage | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (patch.content !== undefined) {
    sets.push(`content = $${index}`);
    values.push(patch.content);
    index += 1;
  }
  if (patch.metadata !== undefined) {
    sets.push(`metadata = $${index}`);
    values.push(JSON.stringify(patch.metadata));
    index += 1;
  }
  if (sets.length === 0) return getMessageInternal(messageId);

  sets.push('updated_at = now()');
  values.push(messageId);
  const result = await query(
    `UPDATE messages SET ${sets.join(', ')} WHERE id = $${index} RETURNING *`,
    values
  );
  const row = result.rows[0];
  return row ? mapMessage(row) : null;
}

/**
 * Build provider context from persisted history. Only complete user/assistant
 * turns are included; failed or in-flight assistant placeholders are skipped.
 */
export async function listContextMessages(
  conversationId: string,
  limit = 40
): Promise<ConversationMessage[]> {
  const result = await query(
    `SELECT * FROM (
       SELECT *
         FROM messages
        WHERE conversation_id = $1
          AND role IN ('user', 'assistant')
          AND content <> ''
        ORDER BY created_at DESC, id DESC
        LIMIT $2
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [conversationId, Math.min(Math.max(limit, 2), 100)]
  );
  return result.rows.map(mapMessage);
}

/** Mark server-interrupted streaming messages as failed after a restart. */
export async function recoverInterruptedMessages(): Promise<number> {
  const result = await query(
    `UPDATE messages
        SET metadata = metadata || jsonb_build_object(
              'status', 'error',
              'error', jsonb_build_object(
                'code', 'STREAM_INTERRUPTED',
                'message', 'The server restarted before this response finished.',
                'retryable', true
              )
            ),
            updated_at = now()
      WHERE role = 'assistant'
        AND metadata ->> 'status' IN ('pending', 'streaming')
      RETURNING id`
  );
  return result.rowCount ?? 0;
}
