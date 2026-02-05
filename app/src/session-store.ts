import { QueueManager } from './queue-manager';

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

  cleanup(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      if (session.pendingTransitionTimer) {
        clearTimeout(session.pendingTransitionTimer);
      }
      this.sessions.delete(userId);
      console.log(`[SessionStore] Cleaned up session for user ${userId}`);
    }
  }

  getAll(): UserSession[] {
    return Array.from(this.sessions.values());
  }
}
