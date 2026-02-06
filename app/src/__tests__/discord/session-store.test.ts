// Discord Session Store Unit Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { DiscordSessionStore, GuildSession } from '../../discord/session-store';

describe('DiscordSessionStore', () => {
  let store: DiscordSessionStore;

  beforeEach(() => {
    store = new DiscordSessionStore();
  });

  describe('getOrCreate', () => {
    it('should create new session for unknown guildId', () => {
      const session = store.getOrCreate('guild-123');

      expect(session).toBeDefined();
      expect(session.guildId).toBe('guild-123');
      expect(session.isPaused).toBe(false);
      expect(session.currentTrack).toBeNull();
      expect(session.queueManager).toBeDefined();
      expect(session.playRequestId).toBe(0);
      expect(session.activePlayRequestId).toBe(0);
    });

    it('should return existing session for known guildId', () => {
      const session1 = store.getOrCreate('guild-123');
      session1.isPaused = true;

      const session2 = store.getOrCreate('guild-123');

      expect(session2).toBe(session1);
      expect(session2.isPaused).toBe(true);
    });

    it('should create separate sessions for different guilds', () => {
      const session1 = store.getOrCreate('guild-123');
      const session2 = store.getOrCreate('guild-456');

      expect(session1).not.toBe(session2);
      expect(session1.guildId).toBe('guild-123');
      expect(session2.guildId).toBe('guild-456');
    });
  });

  describe('get', () => {
    it('should return undefined for unknown guildId', () => {
      const session = store.get('unknown-guild');
      expect(session).toBeUndefined();
    });

    it('should return session for known guildId', () => {
      store.getOrCreate('guild-123');
      const session = store.get('guild-123');

      expect(session).toBeDefined();
      expect(session?.guildId).toBe('guild-123');
    });
  });

  describe('reset', () => {
    it('should reset session state without deleting', () => {
      const session = store.getOrCreate('guild-123');
      session.isPaused = true;
      session.currentTrack = {
        url: 'http://example.com',
        title: 'Test Track',
        duration: 180,
        addedAt: new Date(),
      };
      session.queueManager.addTrack('http://example.com', 'Track', 180);
      session.playRequestId = 5;
      session.activePlayRequestId = 5;

      store.reset('guild-123');

      const resetSession = store.get('guild-123');
      expect(resetSession).toBeDefined();
      expect(resetSession?.isPaused).toBe(false);
      expect(resetSession?.currentTrack).toBeNull();
      expect(resetSession?.queueManager.isEmpty()).toBe(true);
      expect(resetSession?.playRequestId).toBe(0);
      expect(resetSession?.activePlayRequestId).toBe(0);
    });

    it('should do nothing for unknown guildId', () => {
      // Should not throw
      store.reset('unknown-guild');
    });
  });

  describe('delete', () => {
    it('should remove session completely', () => {
      store.getOrCreate('guild-123');
      expect(store.get('guild-123')).toBeDefined();

      store.delete('guild-123');

      expect(store.get('guild-123')).toBeUndefined();
    });

    it('should do nothing for unknown guildId', () => {
      // Should not throw
      store.delete('unknown-guild');
    });
  });

  describe('getActiveCount', () => {
    it('should return 0 for empty store', () => {
      expect(store.getActiveCount()).toBe(0);
    });

    it('should return correct count', () => {
      store.getOrCreate('guild-1');
      store.getOrCreate('guild-2');
      store.getOrCreate('guild-3');

      expect(store.getActiveCount()).toBe(3);
    });

    it('should decrease after delete', () => {
      store.getOrCreate('guild-1');
      store.getOrCreate('guild-2');
      store.delete('guild-1');

      expect(store.getActiveCount()).toBe(1);
    });
  });

  describe('queue isolation', () => {
    it('should have independent queues per guild', () => {
      const session1 = store.getOrCreate('guild-1');
      const session2 = store.getOrCreate('guild-2');

      session1.queueManager.addTrack('http://a.com', 'Track A', 100);
      session1.queueManager.addTrack('http://b.com', 'Track B', 200);

      session2.queueManager.addTrack('http://x.com', 'Track X', 300);

      expect(session1.queueManager.getQueue().length).toBe(2);
      expect(session2.queueManager.getQueue().length).toBe(1);
      expect(session1.queueManager.getQueue()[0].title).toBe('Track A');
      expect(session2.queueManager.getQueue()[0].title).toBe('Track X');
    });

    it('should not affect other guild when one is reset', () => {
      const session1 = store.getOrCreate('guild-1');
      const session2 = store.getOrCreate('guild-2');

      session1.queueManager.addTrack('http://a.com', 'Track A', 100);
      session2.queueManager.addTrack('http://x.com', 'Track X', 300);

      store.reset('guild-1');

      expect(session1.queueManager.isEmpty()).toBe(true);
      expect(session2.queueManager.getQueue().length).toBe(1);
    });
  });

  describe('state management', () => {
    it('should track pause state independently per guild', () => {
      const session1 = store.getOrCreate('guild-1');
      const session2 = store.getOrCreate('guild-2');

      session1.isPaused = true;

      expect(session1.isPaused).toBe(true);
      expect(session2.isPaused).toBe(false);
    });

    it('should track current track independently per guild', () => {
      const session1 = store.getOrCreate('guild-1');
      const session2 = store.getOrCreate('guild-2');

      const track1 = {
        url: 'http://a.com',
        title: 'Track A',
        duration: 100,
        addedAt: new Date(),
      };

      session1.currentTrack = track1;

      expect(session1.currentTrack).toBe(track1);
      expect(session2.currentTrack).toBeNull();
    });
  });
});
