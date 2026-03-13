import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface SessionRow {
  id: string;
  model_id: string;
  provider: string;
  status: string;
  created_at: string;
  last_active: string;
  cli_session_id: string | null;
  config: string | null;
}

export interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL,
        cli_session_id TEXT,
        config TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);
  }

  createSession(modelId: string, provider: string): SessionRow {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, model_id, provider, status, created_at, last_active)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(id, modelId, provider, now, now);

    return this.getSession(id)!;
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ?? null;
  }

  listSessions(): SessionRow[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY last_active DESC').all() as SessionRow[];
  }

  updateSessionStatus(id: string, status: string): void {
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id);
  }

  updateCliSessionId(id: string, cliSessionId: string): void {
    this.db.prepare('UPDATE sessions SET cli_session_id = ? WHERE id = ?').run(cliSessionId, id);
  }

  touchSession(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET last_active = ? WHERE id = ?').run(now, id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  addMessage(sessionId: string, role: string, content: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, role, content, now);
  }

  getMessages(sessionId: string): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as MessageRow[];
  }

  close(): void {
    this.db.close();
  }
}
