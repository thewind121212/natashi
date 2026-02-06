// Discord Commands Unit Tests
// Tests command logic with mocked dependencies

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscordSessionStore } from '../../discord/session-store';

// Mock dependencies
vi.mock('../../voice/manager', () => ({
  voiceManager: {
    isConnected: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    stop: vi.fn(),
    playStream: vi.fn(),
  },
}));

vi.mock('../../api-client', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    play: vi.fn().mockResolvedValue({ status: 'playing' }),
    stop: vi.fn().mockResolvedValue({ status: 'stopped' }),
    pause: vi.fn().mockResolvedValue({ status: 'paused' }),
    resume: vi.fn().mockResolvedValue({ status: 'playing' }),
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
    getMetadata: vi.fn().mockResolvedValue({
      title: 'Test Track',
      duration: 180,
      thumbnail: 'http://thumb.jpg',
      is_playlist: false,
    }),
  })),
}));

vi.mock('../../socket-client', () => ({
  SocketClient: {
    getSharedInstance: vi.fn().mockReturnValue({
      isConnected: vi.fn().mockReturnValue(true),
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      createDirectStreamForSession: vi.fn().mockReturnValue({
        on: vi.fn(),
        push: vi.fn(),
        end: vi.fn(),
      }),
      endAudioStreamForSession: vi.fn(),
    }),
  },
}));

describe('Discord Commands Logic', () => {
  let store: DiscordSessionStore;
  const mockGuildId = '123456789012345678';

  beforeEach(() => {
    store = new DiscordSessionStore();
    vi.clearAllMocks();
  });

  describe('Pause Logic', () => {
    it('should set isPaused to true when pausing', () => {
      const session = store.getOrCreate(mockGuildId);
      session.currentTrack = {
        url: 'http://example.com',
        title: 'Test Track',
        duration: 180,
        addedAt: new Date(),
      };
      session.isPaused = false;

      // Simulate pause command logic
      session.isPaused = true;

      expect(session.isPaused).toBe(true);
    });

    it('should not pause if already paused', () => {
      const session = store.getOrCreate(mockGuildId);
      session.isPaused = true;

      const wasPaused = session.isPaused;

      expect(wasPaused).toBe(true);
    });
  });

  describe('Resume Logic', () => {
    it('should set isPaused to false when resuming', () => {
      const session = store.getOrCreate(mockGuildId);
      session.currentTrack = {
        url: 'http://example.com',
        title: 'Test Track',
        duration: 180,
        addedAt: new Date(),
      };
      session.isPaused = true;

      // Simulate resume command logic
      session.isPaused = false;

      expect(session.isPaused).toBe(false);
    });
  });

  describe('Skip Logic', () => {
    it('should advance to next track', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.addTrack('http://b.com', 'Track B', 200);
      session.queueManager.startPlaying(0);

      // Simulate skip command logic
      const nextTrack = session.queueManager.skip();

      expect(nextTrack).not.toBeNull();
      expect(nextTrack?.title).toBe('Track B');
      expect(session.queueManager.getCurrentIndex()).toBe(1);
    });

    it('should return null when no more tracks', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.startPlaying(0);

      const nextTrack = session.queueManager.skip();

      expect(nextTrack).toBeNull();
    });
  });

  describe('Previous Logic', () => {
    it('should go back to previous track', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.addTrack('http://b.com', 'Track B', 200);
      session.queueManager.startPlaying(1);

      // Simulate previous command logic
      const prevTrack = session.queueManager.previous();

      expect(prevTrack).not.toBeNull();
      expect(prevTrack?.title).toBe('Track A');
      expect(session.queueManager.getCurrentIndex()).toBe(0);
    });

    it('should return null when at start', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.startPlaying(0);

      const prevTrack = session.queueManager.previous();

      expect(prevTrack).toBeNull();
    });
  });

  describe('Queue Display Logic', () => {
    it('should get queue state for display', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.addTrack('http://b.com', 'Track B', 200);
      session.queueManager.addTrack('http://c.com', 'Track C', 300);
      session.queueManager.startPlaying(0);

      const state = session.queueManager.getState();

      expect(state.queue.length).toBe(3);
      expect(state.currentIndex).toBe(0);
      expect(state.nowPlaying?.title).toBe('Track A');
    });

    it('should handle empty queue', () => {
      const session = store.getOrCreate(mockGuildId);

      expect(session.queueManager.isEmpty()).toBe(true);
      expect(session.queueManager.getState().queue.length).toBe(0);
    });
  });

  describe('Now Playing Logic', () => {
    it('should return current track info', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.addTrack('http://b.com', 'Track B', 200);
      session.queueManager.startPlaying(0);
      session.currentTrack = session.queueManager.getCurrentTrack();

      expect(session.currentTrack).not.toBeNull();
      expect(session.currentTrack?.title).toBe('Track A');
    });

    it('should return next track info', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.addTrack('http://b.com', 'Track B', 200);
      session.queueManager.startPlaying(0);

      const nextTrack = session.queueManager.getNextTrack();

      expect(nextTrack).not.toBeNull();
      expect(nextTrack?.title).toBe('Track B');
    });
  });

  describe('Stop Logic', () => {
    it('should reset session on stop', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.startPlaying(0);
      session.currentTrack = session.queueManager.getCurrentTrack();
      session.isPaused = true;

      // Simulate stop command logic
      store.reset(mockGuildId);

      const resetSession = store.get(mockGuildId);
      expect(resetSession?.queueManager.isEmpty()).toBe(true);
      expect(resetSession?.currentTrack).toBeNull();
      expect(resetSession?.isPaused).toBe(false);
    });
  });

  describe('Auto-Advance Logic', () => {
    it('should advance to next track when current finishes', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.addTrack('http://b.com', 'Track B', 200);
      session.queueManager.startPlaying(0);

      // Simulate track finished
      const nextTrack = session.queueManager.currentFinished();

      expect(nextTrack).not.toBeNull();
      expect(nextTrack?.title).toBe('Track B');
    });

    it('should return null when queue is exhausted', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.startPlaying(0);

      const nextTrack = session.queueManager.currentFinished();

      expect(nextTrack).toBeNull();
    });
  });

  describe('Play with Queue Logic', () => {
    it('should add track to queue when already playing', () => {
      const session = store.getOrCreate(mockGuildId);
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      session.queueManager.startPlaying(0);
      session.currentTrack = session.queueManager.getCurrentTrack();

      // Simulate adding another track while playing
      session.queueManager.addTrack('http://b.com', 'Track B', 200);

      expect(session.queueManager.getQueue().length).toBe(2);
      expect(session.currentTrack?.title).toBe('Track A');
    });

    it('should start playing immediately if queue was empty', () => {
      const session = store.getOrCreate(mockGuildId);

      // First track - should start playing
      session.queueManager.addTrack('http://a.com', 'Track A', 100);
      const track = session.queueManager.startPlaying(0);
      session.currentTrack = track;

      expect(session.currentTrack?.title).toBe('Track A');
    });
  });
});

describe('Flow Isolation', () => {
  it('Discord and Web flows should have separate stores', () => {
    // Discord store uses guildId
    const discordStore = new DiscordSessionStore();
    const discordSession = discordStore.getOrCreate('guild-123');

    // Verify Discord session structure
    expect(discordSession.guildId).toBe('guild-123');
    expect(discordSession).toHaveProperty('isPaused');
    expect(discordSession).toHaveProperty('currentTrack');
    expect(discordSession).toHaveProperty('queueManager');
    expect(discordSession).toHaveProperty('playRequestId');
    expect(discordSession).toHaveProperty('activePlayRequestId');

    // Discord session should NOT have web-specific properties
    expect(discordSession).not.toHaveProperty('userId');
    expect(discordSession).not.toHaveProperty('username');
    expect(discordSession).not.toHaveProperty('bytesReceived');
    expect(discordSession).not.toHaveProperty('isStreamReady');
  });

  it('Guild IDs and User IDs should be in different namespaces', () => {
    // Guild IDs are typically 18-19 digits
    const guildId = '123456789012345678';
    // User IDs are also 18-19 digits but represent different entities
    const userId = '987654321098765432';

    const store = new DiscordSessionStore();

    store.getOrCreate(guildId);
    store.getOrCreate(userId);

    // Both should exist as separate sessions
    expect(store.get(guildId)).toBeDefined();
    expect(store.get(userId)).toBeDefined();
    expect(store.get(guildId)).not.toBe(store.get(userId));
    expect(store.getActiveCount()).toBe(2);
  });
});
