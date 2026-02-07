// Discord Session Store - Per-guild state management for Discord bot
// Separate from web SessionStore (uses guildId, not userId)

import { QueueManager, Track } from '../queue-manager';

export interface GuildSession {
  guildId: string;
  textChannelId: string | null; // For sending "Now Playing" messages on auto-advance
  isPaused: boolean;
  isTransitioning: boolean; // Prevents concurrent skip/previous race conditions
  currentTrack: Track | null;
  queueManager: QueueManager;
  playRequestId: number;
  activePlayRequestId: number;
  suppressAutoAdvanceFor: Set<string>; // Session IDs to skip auto-advance for
  playbackStartAt: number | null; // Date.now() when playback started (for progress tracking)
  seekOffset: number; // seconds offset from seek (for progress tracking)
}

export class DiscordSessionStore {
  private sessions = new Map<string, GuildSession>();

  getOrCreate(guildId: string): GuildSession {
    let session = this.sessions.get(guildId);
    if (!session) {
      session = {
        guildId,
        textChannelId: null,
        isPaused: false,
        isTransitioning: false,
        currentTrack: null,
        queueManager: new QueueManager(),
        playRequestId: 0,
        activePlayRequestId: 0,
        suppressAutoAdvanceFor: new Set(),
        playbackStartAt: null,
        seekOffset: 0,
      };
      this.sessions.set(guildId, session);
    }
    return session;
  }

  get(guildId: string): GuildSession | undefined {
    return this.sessions.get(guildId);
  }

  reset(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (session) {
      session.isPaused = false;
      session.isTransitioning = false;
      session.currentTrack = null;
      session.queueManager.clear();
      session.playRequestId = 0;
      session.activePlayRequestId = 0;
      session.suppressAutoAdvanceFor.clear();
      session.playbackStartAt = null;
      session.seekOffset = 0;
    }
  }

  delete(guildId: string): void {
    this.sessions.delete(guildId);
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  getAllSessions(): Map<string, GuildSession> {
    return this.sessions;
  }
}

export const discordSessions = new DiscordSessionStore();
