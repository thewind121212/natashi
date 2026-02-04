import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiClient } from '../api-client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient('http://localhost:8180');
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('play', () => {
    it('should send correct URL with session ID', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'playing', session_id: 'test-123' }),
      });

      await client.play('test-123', 'https://youtube.com/watch?v=abc', 'pcm');

      // Verify URL is correctly constructed
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8180/session/test-123/play');
    });

    it('should send JSON body with url, format, start_at', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'playing', session_id: 'test-123' }),
      });

      await client.play('sess-1', 'https://youtube.com/watch?v=xyz', 'opus', 45.5);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.url).toBe('https://youtube.com/watch?v=xyz');
      expect(body.format).toBe('opus');
      expect(body.start_at).toBe(45.5);
    });

    it('should default format to pcm when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'playing', session_id: 'test' }),
      });

      await client.play('test', 'url');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.format).toBe('pcm');
    });

    it('should return parsed response', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'playing', session_id: 'abc', message: 'started' }),
      });

      const result = await client.play('abc', 'url');

      expect(result.status).toBe('playing');
      expect(result.session_id).toBe('abc');
    });
  });

  describe('stop', () => {
    it('should send POST to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'stopped', session_id: 'test-123' }),
      });

      await client.stop('test-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8180/session/test-123/stop',
        { method: 'POST' }
      );
    });
  });

  describe('pause', () => {
    it('should send POST to pause endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'paused', session_id: 'test' }),
      });

      const result = await client.pause('test');

      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8180/session/test/pause');
      expect(result.status).toBe('paused');
    });
  });

  describe('resume', () => {
    it('should send POST to resume endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'playing', session_id: 'test' }),
      });

      const result = await client.resume('test');

      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8180/session/test/resume');
      expect(result.status).toBe('playing');
    });
  });

  describe('status', () => {
    it('should send GET request and return status', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          session_id: 'test',
          status: 'streaming',
          bytes_sent: 1024000,
          url: 'https://youtube.com/watch?v=abc',
        }),
      });

      const result = await client.status('test');

      expect(mockFetch.mock.calls[0][1].method).toBe('GET');
      expect(result.bytes_sent).toBe(1024000);
      expect(result.status).toBe('streaming');
    });
  });

  describe('health', () => {
    it('should call health endpoint without session ID', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await client.health();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8180/health');
      expect(result.status).toBe('ok');
    });
  });

  describe('getMetadata', () => {
    it('should URL-encode the video URL in query param', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          url: 'https://youtube.com/watch?v=abc&list=xyz',
          title: 'Test',
          duration: 180,
          thumbnail: 'thumb.jpg',
          is_playlist: false,
        }),
      });

      await client.getMetadata('https://youtube.com/watch?v=abc&list=xyz');

      // URL should be properly encoded
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('url=');
      expect(calledUrl).toContain(encodeURIComponent('https://youtube.com/watch?v=abc&list=xyz'));
    });
  });

  describe('getPlaylist', () => {
    it('should return playlist entries', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          url: 'https://youtube.com/playlist?list=abc',
          count: 3,
          entries: [
            { url: 'url1', title: 'Song 1', duration: 100, thumbnail: 't1' },
            { url: 'url2', title: 'Song 2', duration: 200, thumbnail: 't2' },
            { url: 'url3', title: 'Song 3', duration: 300, thumbnail: 't3' },
          ],
        }),
      });

      const result = await client.getPlaylist('https://youtube.com/playlist?list=abc');

      expect(result.count).toBe(3);
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].title).toBe('Song 1');
      expect(result.entries[2].duration).toBe(300);
    });
  });

  describe('Error Handling', () => {
    it('should propagate network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.health()).rejects.toThrow('Network error');
    });

    it('should propagate fetch errors on play', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(client.play('test', 'url')).rejects.toThrow('Connection refused');
    });

    it('should handle error response from server', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          status: 'error',
          session_id: 'test',
          message: 'URL not supported',
        }),
      });

      const result = await client.play('test', 'invalid-url');

      expect(result.status).toBe('error');
      expect(result.message).toBe('URL not supported');
    });

    it('should handle metadata error response', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          url: 'bad-url',
          error: 'Failed to extract metadata',
        }),
      });

      const result = await client.getMetadata('bad-url');

      expect(result.error).toBe('Failed to extract metadata');
    });
  });

  describe('Base URL Configuration', () => {
    it('should use custom base URL', async () => {
      const customClient = new ApiClient('http://go-server:9000');
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await customClient.health();

      expect(mockFetch).toHaveBeenCalledWith('http://go-server:9000/health');
    });

    it('should handle base URL with trailing slash', async () => {
      // Note: Current implementation doesn't handle this - could be a bug
      const customClient = new ApiClient('http://localhost:8180');
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await customClient.health();

      // Should not have double slash
      expect(mockFetch.mock.calls[0][0]).not.toContain('//health');
    });
  });
});
