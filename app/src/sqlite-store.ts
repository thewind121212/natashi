// SQLite Store - Persistence layer for user sessions
import { Database } from 'bun:sqlite';
import { Track } from './queue-manager';
import path from 'path';
import fs from 'fs';

export interface SessionData {
  userId: string;
  username: string;
  avatar: string | null;
  queue: Track[];
  currentIndex: number;
  isPaused: boolean;
  playbackOffsetSec: number;
}

export class SqliteStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    // Default to data/sessions.db in the project root
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'sessions.db');
  }

  init(): void {
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent access
    this.db.exec('PRAGMA journal_mode = WAL');

    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar TEXT,
        queue TEXT NOT NULL DEFAULT '[]',
        current_index INTEGER DEFAULT -1,
        is_paused INTEGER DEFAULT 0,
        playback_offset_sec REAL DEFAULT 0,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    console.log(`[SqliteStore] Initialized at ${this.dbPath}`);
  }

  saveSession(session: SessionData): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.query(`
      INSERT OR REPLACE INTO user_sessions
      (user_id, username, avatar, queue, current_index, is_paused, playback_offset_sec, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);

    // Serialize queue to JSON, converting Date to ISO string
    const queueJson = JSON.stringify(session.queue.map(track => ({
      ...track,
      addedAt: track.addedAt instanceof Date ? track.addedAt.toISOString() : track.addedAt,
    })));

    stmt.run(
      session.userId,
      session.username,
      session.avatar,
      queueJson,
      session.currentIndex,
      session.isPaused ? 1 : 0,
      session.playbackOffsetSec
    );
  }

  loadSession(userId: string): SessionData | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.query(`
      SELECT user_id, username, avatar, queue, current_index, is_paused, playback_offset_sec
      FROM user_sessions WHERE user_id = ?
    `);

    const row = stmt.get(userId) as {
      user_id: string;
      username: string;
      avatar: string | null;
      queue: string;
      current_index: number;
      is_paused: number;
      playback_offset_sec: number;
    } | null;

    if (!row) return null;

    // Parse queue JSON and convert dates back
    let queue: Track[] = [];
    try {
      const parsed = JSON.parse(row.queue);
      queue = parsed.map((t: { url: string; title: string; duration: number; thumbnail?: string; addedAt: string }) => ({
        ...t,
        addedAt: new Date(t.addedAt),
      }));
    } catch {
      console.warn(`[SqliteStore] Failed to parse queue for user ${userId}`);
    }

    return {
      userId: row.user_id,
      username: row.username,
      avatar: row.avatar,
      queue,
      currentIndex: row.current_index,
      isPaused: row.is_paused === 1,
      playbackOffsetSec: row.playback_offset_sec,
    };
  }

  deleteSession(userId: string): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.query('DELETE FROM user_sessions WHERE user_id = ?');
    stmt.run(userId);
    console.log(`[SqliteStore] Deleted session for user ${userId}`);
  }

  loadAllSessions(): SessionData[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.query(`
      SELECT user_id, username, avatar, queue, current_index, is_paused, playback_offset_sec
      FROM user_sessions
    `);

    const rows = stmt.all() as Array<{
      user_id: string;
      username: string;
      avatar: string | null;
      queue: string;
      current_index: number;
      is_paused: number;
      playback_offset_sec: number;
    }>;

    return rows.map(row => {
      let queue: Track[] = [];
      try {
        const parsed = JSON.parse(row.queue);
        queue = parsed.map((t: { url: string; title: string; duration: number; thumbnail?: string; addedAt: string }) => ({
          ...t,
          addedAt: new Date(t.addedAt),
        }));
      } catch {
        console.warn(`[SqliteStore] Failed to parse queue for user ${row.user_id}`);
      }

      return {
        userId: row.user_id,
        username: row.username,
        avatar: row.avatar,
        queue,
        currentIndex: row.current_index,
        isPaused: row.is_paused === 1,
        playbackOffsetSec: row.playback_offset_sec,
      };
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[SqliteStore] Closed');
    }
  }
}
