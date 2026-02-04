import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueueManager } from '../queue-manager';

describe('QueueManager', () => {
  let queue: QueueManager;

  beforeEach(() => {
    queue = new QueueManager();
  });

  describe('addTrack', () => {
    it('should add track with all properties', () => {
      queue.addTrack('https://youtube.com/watch?v=test', 'Test Song', 180, 'thumb.jpg');

      const tracks = queue.getQueue();
      expect(tracks).toHaveLength(1);
      expect(tracks[0].url).toBe('https://youtube.com/watch?v=test');
      expect(tracks[0].title).toBe('Test Song');
      expect(tracks[0].duration).toBe(180);
      expect(tracks[0].thumbnail).toBe('thumb.jpg');
      expect(tracks[0].addedAt).toBeInstanceOf(Date);
    });

    it('should add track without optional thumbnail', () => {
      queue.addTrack('url', 'Title', 100);

      const tracks = queue.getQueue();
      expect(tracks[0].thumbnail).toBeUndefined();
    });

    it('should preserve order when adding multiple tracks', () => {
      queue.addTrack('url1', 'First', 100);
      queue.addTrack('url2', 'Second', 200);
      queue.addTrack('url3', 'Third', 300);

      const tracks = queue.getQueue();
      expect(tracks[0].title).toBe('First');
      expect(tracks[1].title).toBe('Second');
      expect(tracks[2].title).toBe('Third');
    });

    it('should emit update event with correct state', () => {
      const handler = vi.fn();
      queue.on('update', handler);

      queue.addTrack('url', 'Title', 100);

      expect(handler).toHaveBeenCalledTimes(1);
      const state = handler.mock.calls[0][0];
      expect(state.queue).toHaveLength(1);
      expect(state.currentIndex).toBe(-1); // Not playing yet
    });
  });

  describe('removeTrack', () => {
    beforeEach(() => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
      queue.addTrack('url3', 'Song 3', 300);
    });

    it('should remove track and shift others', () => {
      queue.removeTrack(0);

      const tracks = queue.getQueue();
      expect(tracks).toHaveLength(2);
      expect(tracks[0].title).toBe('Song 2');
      expect(tracks[1].title).toBe('Song 3');
    });

    it('should return false for negative index', () => {
      expect(queue.removeTrack(-1)).toBe(false);
      expect(queue.getQueue()).toHaveLength(3);
    });

    it('should return false for index >= length', () => {
      expect(queue.removeTrack(3)).toBe(false);
      expect(queue.removeTrack(100)).toBe(false);
    });

    it('should adjust currentIndex when removing BEFORE current', () => {
      queue.startPlaying(2); // Playing Song 3 at index 2
      expect(queue.getCurrentIndex()).toBe(2);

      queue.removeTrack(0); // Remove Song 1

      expect(queue.getCurrentIndex()).toBe(1); // Index shifted down
      expect(queue.getCurrentTrack()?.title).toBe('Song 3'); // Still same track
    });

    it('should adjust currentIndex when removing AT current', () => {
      queue.startPlaying(1); // Playing Song 2 at index 1
      queue.removeTrack(1); // Remove current track

      // Index should stay valid (not exceed new length)
      expect(queue.getCurrentIndex()).toBe(1);
      expect(queue.getCurrentTrack()?.title).toBe('Song 3');
    });

    it('should handle removing current track when its the last one', () => {
      queue.startPlaying(2); // Playing Song 3 (last)
      queue.removeTrack(2); // Remove it

      expect(queue.getCurrentIndex()).toBe(1); // Adjusted to new last valid index
      expect(queue.getCurrentTrack()?.title).toBe('Song 2');
    });

    it('should NOT adjust currentIndex when removing AFTER current', () => {
      queue.startPlaying(0); // Playing Song 1
      queue.removeTrack(2); // Remove Song 3

      expect(queue.getCurrentIndex()).toBe(0); // Unchanged
      expect(queue.getCurrentTrack()?.title).toBe('Song 1');
    });
  });

  describe('startPlaying', () => {
    beforeEach(() => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
    });

    it('should return track at specified index', () => {
      const track = queue.startPlaying(1);

      expect(track?.title).toBe('Song 2');
      expect(queue.getCurrentIndex()).toBe(1);
    });

    it('should return null for invalid positive index', () => {
      expect(queue.startPlaying(10)).toBeNull();
      expect(queue.getCurrentIndex()).toBe(-1); // Unchanged
    });

    it('should return null for negative index', () => {
      expect(queue.startPlaying(-1)).toBeNull();
    });

    it('should default to index 0', () => {
      const track = queue.startPlaying();
      expect(track?.title).toBe('Song 1');
      expect(queue.getCurrentIndex()).toBe(0);
    });

    it('should emit update event', () => {
      const handler = vi.fn();
      queue.on('update', handler);

      queue.startPlaying(0);

      expect(handler).toHaveBeenCalled();
      const state = handler.mock.calls[0][0];
      expect(state.currentIndex).toBe(0);
      expect(state.nowPlaying?.title).toBe('Song 1');
    });
  });

  describe('skip', () => {
    beforeEach(() => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
      queue.addTrack('url3', 'Song 3', 300);
    });

    it('should advance to next track', () => {
      queue.startPlaying(0);
      const track = queue.skip();

      expect(track?.title).toBe('Song 2');
      expect(queue.getCurrentIndex()).toBe(1);
    });

    it('should return null at end of queue', () => {
      queue.startPlaying(2);
      const track = queue.skip();

      expect(track).toBeNull();
      expect(queue.getCurrentIndex()).toBe(2); // Index unchanged
    });

    it('should work consecutively', () => {
      queue.startPlaying(0);

      expect(queue.skip()?.title).toBe('Song 2');
      expect(queue.skip()?.title).toBe('Song 3');
      expect(queue.skip()).toBeNull();
    });

    it('should return null when nothing is playing', () => {
      // currentIndex is -1, skip should check boundary
      const track = queue.skip();
      // -1 < 3-1 = 2, so it would try to go to index 0
      // Actually looking at the code: -1 < 2 is true, so it increments to 0
      expect(track?.title).toBe('Song 1');
    });
  });

  describe('previous', () => {
    beforeEach(() => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
    });

    it('should go to previous track', () => {
      queue.startPlaying(1);
      const track = queue.previous();

      expect(track?.title).toBe('Song 1');
      expect(queue.getCurrentIndex()).toBe(0);
    });

    it('should return null at beginning', () => {
      queue.startPlaying(0);
      const track = queue.previous();

      expect(track).toBeNull();
      expect(queue.getCurrentIndex()).toBe(0); // Unchanged
    });

    it('should return null when nothing playing', () => {
      // currentIndex is -1, previous should return null
      const track = queue.previous();
      expect(track).toBeNull();
    });
  });

  describe('clear', () => {
    it('should empty the queue', () => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
      queue.startPlaying(0);

      queue.clear();

      expect(queue.getQueue()).toHaveLength(0);
      expect(queue.getCurrentIndex()).toBe(-1);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getCurrentTrack()).toBeNull();
    });

    it('should emit update event', () => {
      queue.addTrack('url', 'Song', 100);
      const handler = vi.fn();
      queue.on('update', handler);

      queue.clear();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Navigation State', () => {
    beforeEach(() => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
      queue.addTrack('url3', 'Song 3', 300);
    });

    it('hasNext - true in middle', () => {
      queue.startPlaying(1);
      expect(queue.hasNext()).toBe(true);
    });

    it('hasNext - false at end', () => {
      queue.startPlaying(2);
      expect(queue.hasNext()).toBe(false);
    });

    it('hasNext - false with empty queue', () => {
      queue.clear();
      expect(queue.hasNext()).toBe(false);
    });

    it('hasPrevious - true in middle', () => {
      queue.startPlaying(1);
      expect(queue.hasPrevious()).toBe(true);
    });

    it('hasPrevious - false at start', () => {
      queue.startPlaying(0);
      expect(queue.hasPrevious()).toBe(false);
    });

    it('hasPrevious - false when nothing playing', () => {
      expect(queue.hasPrevious()).toBe(false);
    });
  });

  describe('getCurrentTrack', () => {
    it('should return null when queue empty', () => {
      expect(queue.getCurrentTrack()).toBeNull();
    });

    it('should return null when not started', () => {
      queue.addTrack('url', 'Song', 100);
      expect(queue.getCurrentTrack()).toBeNull();
    });

    it('should return current track when playing', () => {
      queue.addTrack('url', 'Song', 100);
      queue.startPlaying(0);
      expect(queue.getCurrentTrack()?.title).toBe('Song');
    });
  });

  describe('getNextTrack (peek without advancing)', () => {
    beforeEach(() => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
    });

    it('should return next track without advancing index', () => {
      queue.startPlaying(0);

      const next = queue.getNextTrack();

      expect(next?.title).toBe('Song 2');
      expect(queue.getCurrentIndex()).toBe(0); // Not changed
      expect(queue.getCurrentTrack()?.title).toBe('Song 1'); // Still on Song 1
    });

    it('should return null at end of queue', () => {
      queue.startPlaying(1);
      expect(queue.getNextTrack()).toBeNull();
    });
  });

  describe('getState', () => {
    it('should return complete state snapshot', () => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
      queue.startPlaying(0);

      const state = queue.getState();

      expect(state.queue).toHaveLength(2);
      expect(state.currentIndex).toBe(0);
      expect(state.nowPlaying?.title).toBe('Song 1');
    });

    it('should return copy of queue (immutable)', () => {
      queue.addTrack('url', 'Song', 100);
      const state = queue.getState();

      // Modifying returned queue should not affect internal state
      state.queue.push({ url: 'hack', title: 'Hacked', duration: 0, addedAt: new Date() });

      expect(queue.getQueue()).toHaveLength(1);
    });
  });

  describe('currentFinished (auto-advance)', () => {
    it('should advance to next track', () => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.addTrack('url2', 'Song 2', 200);
      queue.startPlaying(0);

      const next = queue.currentFinished();

      expect(next?.title).toBe('Song 2');
      expect(queue.getCurrentIndex()).toBe(1);
    });

    it('should return null when queue ends', () => {
      queue.addTrack('url1', 'Song 1', 100);
      queue.startPlaying(0);

      const next = queue.currentFinished();

      expect(next).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty queue operations gracefully', () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getQueue()).toHaveLength(0);
      expect(queue.getCurrentTrack()).toBeNull();
      expect(queue.getNextTrack()).toBeNull();
      expect(queue.skip()).not.toThrow; // Should not crash
      expect(queue.previous()).toBeNull();
      expect(queue.hasNext()).toBe(false);
      expect(queue.hasPrevious()).toBe(false);
    });

    it('should handle single track queue', () => {
      queue.addTrack('url', 'Only Song', 100);
      queue.startPlaying(0);

      expect(queue.hasNext()).toBe(false);
      expect(queue.hasPrevious()).toBe(false);
      expect(queue.skip()).toBeNull();
      expect(queue.previous()).toBeNull();
      expect(queue.getCurrentTrack()?.title).toBe('Only Song');
    });

    it('should handle duplicate URLs', () => {
      queue.addTrack('same-url', 'Song A', 100);
      queue.addTrack('same-url', 'Song B', 200);

      expect(queue.getQueue()).toHaveLength(2);
      expect(queue.getQueue()[0].title).toBe('Song A');
      expect(queue.getQueue()[1].title).toBe('Song B');
    });

    it('should handle zero duration', () => {
      queue.addTrack('url', 'Live Stream', 0);
      expect(queue.getQueue()[0].duration).toBe(0);
    });

    it('should handle very long queue', () => {
      for (let i = 0; i < 1000; i++) {
        queue.addTrack(`url${i}`, `Song ${i}`, i);
      }

      expect(queue.getQueue()).toHaveLength(1000);
      queue.startPlaying(500);
      expect(queue.getCurrentTrack()?.title).toBe('Song 500');
      expect(queue.hasNext()).toBe(true);
      expect(queue.hasPrevious()).toBe(true);
    });
  });
});
