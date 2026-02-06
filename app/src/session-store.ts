import { QueueManager, Track } from './queue-manager';
import { SqliteStore, SessionData } from './sqlite-store';

export interface UserSession {
  userId: string;              // Discord user ID
  username: string;
  avatar: string | null;
  queueManager: QueueManager;  // Per-user queue
  currentSessionId: string | null;
  isPaused: boolean;
  isStreamReady: boolean;
  bytesReceived: number;
  playRequestId: number;
  activePlayRequestId: number;
  playbackStartAt: number | null;
  playbackOffsetSec: number;
  pendingTransitionTimer: NodeJS.Timeout | null;
  pendingTransitionRequestId: number;
  suppressAutoAdvanceFor: Set<string>;
}

export class SessionStore {
  private sessions = new Map<string, UserSession>();
  private sqliteStore: SqliteStore | null = null;
  private persistTimers = new Map<string, NodeJS.Timeout>();
  private static readonly PERSIST_DEBOUNCE_MS = 100;

  constructor(sqliteStore?: SqliteStore) {
    if (sqliteStore) {
      this.sqliteStore = sqliteStore;
      this.restoreFromDb();
    }
  }

  private restoreFromDb(): void {
    if (!this.sqliteStore) return;

    const savedSessions = this.sqliteStore.loadAllSessions();
    console.log(`[SessionStore] Restoring ${savedSessions.length} session(s) from database`);

    for (const data of savedSessions) {
      const session = this.createSessionFromData(data);
      this.sessions.set(data.userId, session);
      console.log(`[SessionStore] Restored session for ${data.username} (${data.userId}) with ${data.queue.length} tracks`);
    }
  }

  private createSessionFromData(data: SessionData): UserSession {
    const queueManager = new QueueManager();

    // Restore tracks to queue manager
    for (const track of data.queue) {
      queueManager.addTrack(track.url, track.title, track.duration, track.thumbnail);
    }

    // Restore current index if valid
    if (data.currentIndex >= 0 && data.currentIndex < data.queue.length) {
      queueManager.startPlaying(data.currentIndex);
    }

    return {
      userId: data.userId,
      username: data.username,
      avatar: data.avatar,
      queueManager,
      currentSessionId: null, // Reset - playback needs to be restarted
      isPaused: false,        // Reset - can't resume old playback
      isStreamReady: false,
      bytesReceived: 0,
      playRequestId: 0,
      activePlayRequestId: 0,
      playbackStartAt: null,
      playbackOffsetSec: 0,
      pendingTransitionTimer: null,
      pendingTransitionRequestId: 0,
      suppressAutoAdvanceFor: new Set(),
    };
  }

  getOrCreate(userId: string, username: string, avatar: string | null): UserSession {
    let session = this.sessions.get(userId);
    if (!session) {
      session = {
        userId,
        username,
        avatar,
        queueManager: new QueueManager(),
        currentSessionId: null,
        isPaused: false,
        isStreamReady: false,
        bytesReceived: 0,
        playRequestId: 0,
        activePlayRequestId: 0,
        playbackStartAt: null,
        playbackOffsetSec: 0,
        pendingTransitionTimer: null,
        pendingTransitionRequestId: 0,
        suppressAutoAdvanceFor: new Set(),
      };
      this.sessions.set(userId, session);
      console.log(`[SessionStore] Created session for user ${userId} (${username})`);
    } else {
      // Update user info in case it changed
      session.username = username;
      session.avatar = avatar;
    }
    return session;
  }

  get(userId: string): UserSession | undefined {
    return this.sessions.get(userId);
  }

  // Find session by current Go session ID (for routing audio/events)
  findBySessionId(sessionId: string): UserSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.currentSessionId === sessionId) {
        return session;
      }
    }
    return undefined;
  }

  // Persist session to SQLite (debounced)
  persist(userId: string): void {
    if (!this.sqliteStore) return;

    // Clear existing timer for this user
    const existingTimer = this.persistTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.persistTimers.delete(userId);
      this.persistNow(userId);
    }, SessionStore.PERSIST_DEBOUNCE_MS);

    this.persistTimers.set(userId, timer);
  }

  private persistNow(userId: string): void {
    if (!this.sqliteStore) return;

    const session = this.sessions.get(userId);
    if (!session) return;

    const data: SessionData = {
      userId: session.userId,
      username: session.username,
      avatar: session.avatar,
      queue: session.queueManager.getQueue(),
      currentIndex: session.queueManager.getCurrentIndex(),
      isPaused: session.isPaused,
      playbackOffsetSec: session.playbackOffsetSec,
    };

    this.sqliteStore.saveSession(data);
  }

  // Cancel any pending persist for a user
  cancelPersist(userId: string): void {
    const existingTimer = this.persistTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.persistTimers.delete(userId);
    }
  }

  // Reset session completely (for "reset" action)
  resetSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;

    // IMPORTANT: Cancel any pending persist BEFORE clearing queue
    // Otherwise queueManager.clear() emits 'persist' and the debounced
    // timer could re-insert an empty session after we delete
    this.cancelPersist(userId);

    // Clear the queue (this emits 'persist' but we cancelled the timer above)
    session.queueManager.clear();

    // Cancel again in case clear() scheduled a new one
    this.cancelPersist(userId);

    // Reset all state
    session.currentSessionId = null;
    session.isPaused = false;
    session.isStreamReady = false;
    session.bytesReceived = 0;
    session.playbackStartAt = null;
    session.playbackOffsetSec = 0;

    // Delete from persistence
    if (this.sqliteStore) {
      this.sqliteStore.deleteSession(userId);
    }

    console.log(`[SessionStore] Reset session for user ${userId}`);
  }

  cleanup(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      if (session.pendingTransitionTimer) {
        clearTimeout(session.pendingTransitionTimer);
      }
      // Clear persist timer
      const persistTimer = this.persistTimers.get(userId);
      if (persistTimer) {
        clearTimeout(persistTimer);
        this.persistTimers.delete(userId);
      }
      this.sessions.delete(userId);
      console.log(`[SessionStore] Cleaned up session for user ${userId}`);
    }
  }

  getAll(): UserSession[] {
    return Array.from(this.sessions.values());
  }
}
