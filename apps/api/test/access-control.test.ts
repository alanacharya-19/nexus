import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({ query: mocks.query }));

const {
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} = await import('../src/repositories/conversations.js');
const { getMessage, listMessages } = await import('../src/repositories/messages.js');

const userId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';
const messageId = '33333333-3333-3333-3333-333333333333';

function lastQuery(): { sql: string; params: unknown[] } {
  const call = mocks.query.mock.calls.at(-1);
  return {
    sql: String(call?.[0] ?? '').replace(/\s+/g, ' '),
    params: Array.isArray(call?.[1]) ? (call[1] as unknown[]) : [],
  };
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('conversation ownership enforcement', () => {
  it('reads a conversation only through its owning user', async () => {
    await getConversation(userId, conversationId);
    const { sql, params } = lastQuery();

    expect(sql).toContain('c.user_id = $1 AND c.id = $2');
    expect(params[0]).toBe(userId);
    expect(params[1]).toBe(conversationId);
  });

  it('lists conversations scoped to the authenticated user', async () => {
    await listConversations(userId, { limit: 20 });
    const { sql, params } = lastQuery();

    expect(sql).toContain('WHERE c.user_id = $1');
    expect(params[0]).toBe(userId);
  });

  it('keeps project and search filters as parameters, not string interpolation', async () => {
    await listConversations(userId, {
      limit: 10,
      projectId: conversationId,
      search: "'; DROP TABLE conversations; --",
    });
    const { sql, params } = lastQuery();

    expect(sql).toContain('c.project_id = $2');
    expect(sql).toContain('c.title ILIKE $3');
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain("%'; DROP TABLE conversations; --%");
  });

  it('updates and deletes only rows owned by the requesting user', async () => {
    await updateConversation(userId, conversationId, { title: 'Renamed' });
    let { sql, params } = lastQuery();
    expect(sql).toContain('WHERE user_id = $2 AND id = $3');
    expect(params).toContain(userId);
    expect(params).toContain(conversationId);

    await deleteConversation(userId, conversationId);
    ({ sql, params } = lastQuery());
    expect(sql).toContain('WHERE user_id = $1 AND id = $2');
    expect(params).toEqual([userId, conversationId]);
  });
});

describe('message ownership enforcement', () => {
  it('joins the conversation and matches the owning user', async () => {
    await listMessages(userId, conversationId, { limit: 50 });
    const { sql, params } = lastQuery();

    expect(sql).toContain('JOIN conversations c ON c.id = m.conversation_id');
    expect(sql).toContain('WHERE c.user_id = $1 AND m.conversation_id = $2');
    expect(params[0]).toBe(userId);
    expect(params[1]).toBe(conversationId);
  });

  it('never fetches a message by id alone for user-facing reads', async () => {
    await getMessage(userId, conversationId, messageId);
    const { sql, params } = lastQuery();

    expect(sql).toContain('JOIN conversations c ON c.id = m.conversation_id');
    expect(sql).toContain('c.user_id = $1');
    expect(sql).toContain('m.id = $3');
    expect(params).toEqual([userId, conversationId, messageId]);
  });

  it('keeps the after cursor parameterised', async () => {
    const cursor = '2026-01-01T00:00:00.000Z';
    await listMessages(userId, conversationId, { after: cursor, limit: 5 });
    const { sql, params } = lastQuery();

    expect(sql).toContain('AND m.created_at > $3');
    expect(sql).not.toContain(cursor);
    expect(params).toContain(cursor);
  });
});
