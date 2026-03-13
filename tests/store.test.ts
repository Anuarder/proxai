import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../src/sessions/store.js';
import type { SessionRow, MessageRow } from '../src/sessions/store.js';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('creates tables on construction', () => {
    // If construction succeeds and we can call methods without errors,
    // tables were created. Verify by inserting and reading back.
    const session = store.createSession('model-1', 'claude');
    expect(session).toBeDefined();

    const messages = store.getMessages(session.id);
    expect(messages).toEqual([]);
  });

  it('createSession returns a SessionRow with UUID and active status', () => {
    const session = store.createSession('gpt-4', 'openai');

    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.model_id).toBe('gpt-4');
    expect(session.provider).toBe('openai');
    expect(session.status).toBe('active');
    expect(session.created_at).toBeTruthy();
    expect(session.last_active).toBeTruthy();
    expect(session.cli_session_id).toBeNull();
    expect(session.config).toBeNull();
  });

  it('getSession returns session or null', () => {
    const created = store.createSession('model-1', 'claude');

    const found = store.getSession(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.model_id).toBe('model-1');

    const notFound = store.getSession('non-existent-id');
    expect(notFound).toBeNull();
  });

  it('listSessions returns sessions ordered by last_active DESC and supports update methods', () => {
    const s1 = store.createSession('model-a', 'provider-a');
    const s2 = store.createSession('model-b', 'provider-b');

    // Touch s1 so it becomes more recent
    store.touchSession(s1.id);

    const sessions = store.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe(s1.id);
    expect(sessions[1].id).toBe(s2.id);

    // Test updateSessionStatus
    store.updateSessionStatus(s1.id, 'closed');
    const updated = store.getSession(s1.id);
    expect(updated!.status).toBe('closed');

    // Test updateCliSessionId
    store.updateCliSessionId(s2.id, 'cli-abc-123');
    const updated2 = store.getSession(s2.id);
    expect(updated2!.cli_session_id).toBe('cli-abc-123');
  });

  it('deleteSession removes session and cascades to messages', () => {
    const session = store.createSession('model-1', 'claude');
    store.addMessage(session.id, 'user', 'hello');
    store.addMessage(session.id, 'assistant', 'hi there');

    // Verify messages exist
    expect(store.getMessages(session.id).length).toBe(2);

    store.deleteSession(session.id);

    // Session gone
    expect(store.getSession(session.id)).toBeNull();

    // Messages also gone (cascade)
    expect(store.getMessages(session.id)).toEqual([]);
  });

  it('addMessage and getMessages store and retrieve messages in order', () => {
    const session = store.createSession('model-1', 'claude');

    store.addMessage(session.id, 'user', 'first message');
    store.addMessage(session.id, 'assistant', 'second message');
    store.addMessage(session.id, 'user', 'third message');

    const messages = store.getMessages(session.id);
    expect(messages.length).toBe(3);

    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('first message');
    expect(messages[0].session_id).toBe(session.id);
    expect(messages[0].id).toBeLessThan(messages[1].id);

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('second message');

    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('third message');

    // Each message has a timestamp
    for (const msg of messages) {
      expect(msg.timestamp).toBeTruthy();
    }
  });

  it('close() closes the database connection', () => {
    const s = new SessionStore(':memory:');
    s.createSession('m', 'p');
    s.close();

    // After close, operations should throw
    expect(() => s.createSession('m', 'p')).toThrow();
  });
});
