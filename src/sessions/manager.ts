import { SessionStore, type SessionRow } from './store.js';

export interface SessionManagerConfig {
  idle_timeout_ms: number;
  max_concurrent: number;
}

export class SessionManager {
  private store: SessionStore;
  private config: SessionManagerConfig;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private onIdle: ((sessionId: string) => void) | null = null;

  constructor(store: SessionStore, config: SessionManagerConfig) {
    this.store = store;
    this.config = config;
    this.startIdleChecker();
  }

  setOnIdleCallback(cb: (sessionId: string) => void): void {
    this.onIdle = cb;
  }

  createSession(modelId: string, provider: string): SessionRow {
    const active = this.store.listSessions().filter((s) => s.status === 'active');
    if (active.length >= this.config.max_concurrent) {
      throw new Error(`Max concurrent sessions (${this.config.max_concurrent}) reached`);
    }
    return this.store.createSession(modelId, provider);
  }

  getSession(id: string): SessionRow | null {
    return this.store.getSession(id);
  }

  listSessions(): SessionRow[] {
    return this.store.listSessions();
  }

  touchSession(id: string): void {
    this.store.touchSession(id);
  }

  deleteSession(id: string): void {
    this.store.deleteSession(id);
  }

  updateStatus(id: string, status: string): void {
    this.store.updateSessionStatus(id, status);
  }

  updateCliSessionId(id: string, cliSessionId: string): void {
    this.store.updateCliSessionId(id, cliSessionId);
  }

  addMessage(sessionId: string, role: string, content: string): void {
    this.store.addMessage(sessionId, role, content);
  }

  getMessages(sessionId: string) {
    return this.store.getMessages(sessionId);
  }

  private startIdleChecker(): void {
    this.idleTimer = setInterval(() => {
      const sessions = this.store.listSessions();
      const now = Date.now();
      for (const session of sessions) {
        if (session.status !== 'active') continue;
        const lastActive = new Date(session.last_active).getTime();
        if (now - lastActive > this.config.idle_timeout_ms) {
          this.store.updateSessionStatus(session.id, 'idle');
          if (this.onIdle) {
            this.onIdle(session.id);
          }
        }
      }
    }, Math.min(this.config.idle_timeout_ms, 10000));
  }

  shutdown(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
