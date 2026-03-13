import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../src/sessions/manager.js';
import { SessionStore } from '../src/sessions/store.js';

describe('SessionManager', () => {
  let store: SessionStore;
  let manager: SessionManager;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    manager = new SessionManager(store, {
      idle_timeout_ms: 500,
      max_concurrent: 2,
    });
  });

  afterEach(() => {
    manager.shutdown();
    store.close();
  });

  it('creates a session and stores it', () => {
    const session = manager.createSession('claude-code', 'claude');
    expect(session.id).toBeDefined();
    expect(store.getSession(session.id)).not.toBeNull();
  });

  it('rejects when max concurrent sessions reached', () => {
    manager.createSession('claude-code', 'claude');
    manager.createSession('claude-code', 'claude');
    expect(() => manager.createSession('claude-code', 'claude')).toThrow(/max concurrent/i);
  });

  it('gets a session by id', () => {
    const session = manager.createSession('claude-code', 'claude');
    const retrieved = manager.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
  });

  it('deletes a session', () => {
    const session = manager.createSession('claude-code', 'claude');
    manager.deleteSession(session.id);
    expect(manager.getSession(session.id)).toBeNull();
  });

  it('calls onIdle callback when session goes idle', async () => {
    const onIdle = vi.fn();
    manager.setOnIdleCallback(onIdle);
    const session = manager.createSession('claude-code', 'claude');
    // Wait for idle checker to run
    await new Promise((r) => setTimeout(r, 700));
    expect(onIdle).toHaveBeenCalledWith(session.id);
  });
});
