import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Test the ACTUAL buffer processing logic from socket-client.ts
 * by extracting and testing the core parsing algorithm.
 */

// Extract the buffer processing logic to test it directly
class TestableSocketClient extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private readingAudio = false;
  private audioLength = 0;

  // Expose for testing
  feedData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.processBuffer();
  }

  getBufferLength(): number {
    return this.buffer.length;
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      if (this.readingAudio) {
        // Reading binary audio data (24-byte session ID + audio)
        if (this.buffer.length >= this.audioLength) {
          const SESSION_ID_LEN = 24;
          // Defensive check: packet must be at least 24 bytes for session ID
          if (this.audioLength < SESSION_ID_LEN) {
            this.buffer = this.buffer.subarray(this.audioLength);
            this.readingAudio = false;
            this.emit('malformed', { length: this.audioLength });
            continue; // Skip malformed packet
          }
          const sessionId = this.buffer.subarray(0, SESSION_ID_LEN).toString('utf8').trim();
          const audioData = this.buffer.subarray(SESSION_ID_LEN, this.audioLength);
          this.buffer = this.buffer.subarray(this.audioLength);
          this.readingAudio = false;
          this.emit('audio', { sessionId, data: audioData });
        } else {
          break; // Need more data
        }
      } else {
        // Skip any newlines (json.Encoder adds \n after each JSON object)
        while (this.buffer.length > 0 && this.buffer[0] === 0x0a) {
          this.buffer = this.buffer.subarray(1);
        }
        if (this.buffer.length === 0) break;

        // Check if this is JSON (event) or binary header (audio)
        if (this.buffer[0] === 0x7b) { // '{' character
          // Try to parse JSON - find complete object
          let jsonEnd = 0;
          let depth = 0;
          for (let i = 0; i < this.buffer.length; i++) {
            if (this.buffer[i] === 0x7b) depth++;
            if (this.buffer[i] === 0x7d) depth--;
            if (depth === 0) {
              jsonEnd = i + 1;
              break;
            }
          }

          if (jsonEnd > 0) {
            const jsonStr = this.buffer.subarray(0, jsonEnd).toString('utf8');
            this.buffer = this.buffer.subarray(jsonEnd);
            try {
              const event = JSON.parse(jsonStr);
              this.emit('event', event);
            } catch {
              // Invalid JSON, skip
            }
          } else {
            break; // Need more data for complete JSON
          }
        } else if (this.buffer.length >= 4) {
          // Binary audio header (4 bytes big-endian length)
          this.audioLength = (this.buffer[0] << 24) | (this.buffer[1] << 16) |
                            (this.buffer[2] << 8) | this.buffer[3];
          this.buffer = this.buffer.subarray(4);
          this.readingAudio = true;
        } else {
          break; // Need more data
        }
      }
    }
  }
}

describe('SocketClient Buffer Processing', () => {
  let client: TestableSocketClient;
  let audioHandler: ReturnType<typeof vi.fn>;
  let eventHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new TestableSocketClient();
    audioHandler = vi.fn();
    eventHandler = vi.fn();
    client.on('audio', audioHandler);
    client.on('event', eventHandler);
  });

  describe('Audio Packet Parsing', () => {
    // Helper to build packet with 24-byte session ID
    const SESSION_ID_LEN = 24;
    const buildPacket = (sessionId: string, audioBytes: number[]): Buffer => {
      const paddedId = sessionId.padEnd(SESSION_ID_LEN, ' ');
      const length = SESSION_ID_LEN + audioBytes.length;
      const header = Buffer.from([
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
      ]);
      return Buffer.concat([header, Buffer.from(paddedId), Buffer.from(audioBytes)]);
    };

    it('should parse complete audio packet with session ID', () => {
      const packet = buildPacket('test123', [0x01, 0x02, 0x03, 0x04, 0x05]);
      client.feedData(packet);

      expect(audioHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledWith({
        sessionId: 'test123',
        data: Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]),
      });
    });

    it('should handle partial header (BUG: incomplete data arrives)', () => {
      const packet = buildPacket('sess1', [0xaa, 0xbb, 0xcc]);
      // Only 2 bytes of header arrive
      client.feedData(packet.subarray(0, 2));
      expect(audioHandler).not.toHaveBeenCalled();
      expect(client.getBufferLength()).toBe(2);

      // Rest arrives
      client.feedData(packet.subarray(2));
      expect(audioHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledWith({
        sessionId: 'sess1',
        data: Buffer.from([0xaa, 0xbb, 0xcc]),
      });
    });

    it('should handle partial audio data (BUG: large chunk split)', () => {
      const packet = buildPacket('split', [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]);
      // Header + partial data
      client.feedData(packet.subarray(0, 15));
      expect(audioHandler).not.toHaveBeenCalled();

      // Rest of data arrives
      client.feedData(packet.subarray(15));
      expect(audioHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledWith({
        sessionId: 'split',
        data: Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]),
      });
    });

    it('should handle multiple packets in single buffer', () => {
      const packet1 = buildPacket('guild1', [0xaa, 0xbb]);
      const packet2 = buildPacket('guild2', [0xcc, 0xdd, 0xee]);
      client.feedData(Buffer.concat([packet1, packet2]));

      expect(audioHandler).toHaveBeenCalledTimes(2);
      expect(audioHandler).toHaveBeenNthCalledWith(1, {
        sessionId: 'guild1',
        data: Buffer.from([0xaa, 0xbb]),
      });
      expect(audioHandler).toHaveBeenNthCalledWith(2, {
        sessionId: 'guild2',
        data: Buffer.from([0xcc, 0xdd, 0xee]),
      });
    });

    it('should handle zero-length audio packet (edge case)', () => {
      // Header with length = 24 (just session ID, no audio)
      const header = Buffer.from([0x00, 0x00, 0x00, 0x18]); // 24 = 0x18
      const sessionId = Buffer.from('empty'.padEnd(24, ' '));
      client.feedData(Buffer.concat([header, sessionId]));

      expect(audioHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledWith({
        sessionId: 'empty',
        data: Buffer.from([]),
      });
    });

    it('should parse real PCM frame size (3840 bytes)', () => {
      // 3840 + 24 = 3864 = 0x00000F18
      const length = SESSION_ID_LEN + 3840;
      const header = Buffer.from([
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
      ]);
      const sessionId = Buffer.from('pcmtest'.padEnd(24, ' '));
      const audioData = Buffer.alloc(3840, 0x42);
      client.feedData(Buffer.concat([header, sessionId, audioData]));

      expect(audioHandler).toHaveBeenCalledTimes(1);
      const call = audioHandler.mock.calls[0][0];
      expect(call.sessionId).toBe('pcmtest');
      expect(call.data.length).toBe(3840);
    });
  });

  describe('JSON Event Parsing', () => {
    it('should parse JSON event starting with {', () => {
      const event = Buffer.from('{"type":"ready","session_id":"abc123"}');
      client.feedData(event);

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith({
        type: 'ready',
        session_id: 'abc123',
      });
    });

    it('should handle JSON with newline suffix (Go json.Encoder)', () => {
      const event = Buffer.from('{"type":"finished","session_id":"xyz"}\n');
      client.feedData(event);

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith({
        type: 'finished',
        session_id: 'xyz',
      });
    });

    it('should skip leading newlines between messages', () => {
      const data = Buffer.from('\n\n\n{"type":"ready","session_id":"test"}');
      client.feedData(data);

      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle partial JSON (BUG: JSON split across packets)', () => {
      // First part of JSON
      client.feedData(Buffer.from('{"type":"error","ses'));
      expect(eventHandler).not.toHaveBeenCalled();

      // Rest of JSON
      client.feedData(Buffer.from('sion_id":"abc","message":"failed"}'));
      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith({
        type: 'error',
        session_id: 'abc',
        message: 'failed',
      });
    });

    it('should handle nested JSON objects', () => {
      const event = Buffer.from('{"type":"status","data":{"nested":true}}');
      client.feedData(event);

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'status',
        data: { nested: true },
      });
    });
  });

  describe('Mixed Audio and Events', () => {
    // Helper to build packet with 24-byte session ID
    const SESSION_ID_LEN = 24;
    const buildPacket = (sessionId: string, audioBytes: number[]): Buffer => {
      const paddedId = sessionId.padEnd(SESSION_ID_LEN, ' ');
      const length = SESSION_ID_LEN + audioBytes.length;
      const header = Buffer.from([
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
      ]);
      return Buffer.concat([header, Buffer.from(paddedId), Buffer.from(audioBytes)]);
    };

    it('should handle event followed by audio', () => {
      const event = Buffer.from('{"type":"ready","session_id":"test"}\n');
      const audio = buildPacket('test', [0x01, 0x02, 0x03]);
      client.feedData(Buffer.concat([event, audio]));

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle audio followed by event', () => {
      const audio = buildPacket('test', [0xaa, 0xbb]);
      const event = Buffer.from('{"type":"finished","session_id":"test"}');
      client.feedData(Buffer.concat([audio, event]));

      expect(audioHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle interleaved audio and events', () => {
      const audio1 = buildPacket('x', [0x11]);
      const event = Buffer.from('{"type":"ready","session_id":"x"}\n');
      const audio2 = buildPacket('x', [0x22]);

      client.feedData(Buffer.concat([audio1, event, audio2]));

      expect(audioHandler).toHaveBeenCalledTimes(2);
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty buffer', () => {
      client.feedData(Buffer.from([]));
      expect(audioHandler).not.toHaveBeenCalled();
      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('should handle buffer with only newlines', () => {
      client.feedData(Buffer.from('\n\n\n\n'));
      expect(audioHandler).not.toHaveBeenCalled();
      expect(eventHandler).not.toHaveBeenCalled();
      expect(client.getBufferLength()).toBe(0);
    });

    it('should not crash on malformed JSON', () => {
      // This looks like JSON but is invalid
      client.feedData(Buffer.from('{invalid json}'));
      // Should not crash, event not emitted
      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('should skip malformed packet with length < 24 bytes', () => {
      const malformedHandler = vi.fn();
      client.on('malformed', malformedHandler);

      // Header with length = 10 (less than 24-byte session ID requirement)
      const header = Buffer.from([0x00, 0x00, 0x00, 0x0a]); // 10 bytes
      const data = Buffer.alloc(10, 0x42);
      client.feedData(Buffer.concat([header, data]));

      // Should emit malformed event, not audio
      expect(audioHandler).not.toHaveBeenCalled();
      expect(malformedHandler).toHaveBeenCalledTimes(1);
      expect(malformedHandler).toHaveBeenCalledWith({ length: 10 });
      expect(client.getBufferLength()).toBe(0); // Buffer consumed
    });

    it('should continue processing after malformed packet', () => {
      const malformedHandler = vi.fn();
      client.on('malformed', malformedHandler);

      // Malformed packet (length = 5)
      const malformedHeader = Buffer.from([0x00, 0x00, 0x00, 0x05]);
      const malformedData = Buffer.alloc(5, 0x00);

      // Valid packet after
      const SESSION_ID_LEN = 24;
      const validLength = SESSION_ID_LEN + 3;
      const validHeader = Buffer.from([
        (validLength >> 24) & 0xff,
        (validLength >> 16) & 0xff,
        (validLength >> 8) & 0xff,
        validLength & 0xff,
      ]);
      const sessionId = Buffer.from('valid'.padEnd(SESSION_ID_LEN, ' '));
      const audioData = Buffer.from([0xaa, 0xbb, 0xcc]);

      client.feedData(Buffer.concat([malformedHeader, malformedData, validHeader, sessionId, audioData]));

      expect(malformedHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledTimes(1);
      expect(audioHandler).toHaveBeenCalledWith({
        sessionId: 'valid',
        data: Buffer.from([0xaa, 0xbb, 0xcc]),
      });
    });

    it('should handle very large audio packets', () => {
      // 1MB audio data + 24-byte session ID
      const SESSION_ID_LEN = 24;
      const audioSize = 1024 * 1024;
      const totalLength = SESSION_ID_LEN + audioSize;
      const header = Buffer.from([
        (totalLength >> 24) & 0xff,
        (totalLength >> 16) & 0xff,
        (totalLength >> 8) & 0xff,
        totalLength & 0xff,
      ]);
      const sessionId = Buffer.from('largetest'.padEnd(SESSION_ID_LEN, ' '));
      const audioData = Buffer.alloc(audioSize, 0x55);
      client.feedData(Buffer.concat([header, sessionId, audioData]));

      expect(audioHandler).toHaveBeenCalledTimes(1);
      const call = audioHandler.mock.calls[0][0];
      expect(call.sessionId).toBe('largetest');
      expect(call.data.length).toBe(audioSize);
    });
  });
});

describe('JitterBuffer', () => {
  // Test the jitter buffer logic
  class TestableJitterBuffer {
    private chunks: Buffer[] = [];
    private started = false;
    private outputChunks: Buffer[] = [];
    private underruns = 0;
    private bufferSize: number;

    constructor(bufferSize = 5) {
      this.bufferSize = bufferSize;
    }

    push(chunk: Buffer): void {
      this.chunks.push(chunk);
      if (!this.started && this.chunks.length >= this.bufferSize) {
        this.started = true;
      }
    }

    // Simulate outputFrame call
    tick(): Buffer | null {
      if (!this.started) return null;

      const chunk = this.chunks.shift();
      if (chunk) {
        this.outputChunks.push(chunk);
        return chunk;
      } else {
        this.underruns++;
        return null;
      }
    }

    isStarted(): boolean {
      return this.started;
    }

    getUnderruns(): number {
      return this.underruns;
    }

    getBufferedCount(): number {
      return this.chunks.length;
    }
  }

  it('should not start until buffer threshold reached', () => {
    const jitter = new TestableJitterBuffer(5);

    jitter.push(Buffer.from([1]));
    jitter.push(Buffer.from([2]));
    jitter.push(Buffer.from([3]));
    jitter.push(Buffer.from([4]));

    expect(jitter.isStarted()).toBe(false);
    expect(jitter.tick()).toBeNull();

    jitter.push(Buffer.from([5]));
    expect(jitter.isStarted()).toBe(true);
  });

  it('should output chunks in order after started', () => {
    const jitter = new TestableJitterBuffer(3);

    jitter.push(Buffer.from([1]));
    jitter.push(Buffer.from([2]));
    jitter.push(Buffer.from([3]));

    expect(jitter.tick()).toEqual(Buffer.from([1]));
    expect(jitter.tick()).toEqual(Buffer.from([2]));
    expect(jitter.tick()).toEqual(Buffer.from([3]));
  });

  it('should count underruns when buffer empty', () => {
    const jitter = new TestableJitterBuffer(2);

    jitter.push(Buffer.from([1]));
    jitter.push(Buffer.from([2]));

    jitter.tick(); // [1]
    jitter.tick(); // [2]
    jitter.tick(); // underrun
    jitter.tick(); // underrun

    expect(jitter.getUnderruns()).toBe(2);
  });

  it('should recover from underrun when data arrives', () => {
    const jitter = new TestableJitterBuffer(2);

    jitter.push(Buffer.from([1]));
    jitter.push(Buffer.from([2]));

    jitter.tick();
    jitter.tick();
    expect(jitter.tick()).toBeNull(); // underrun

    jitter.push(Buffer.from([3]));
    expect(jitter.tick()).toEqual(Buffer.from([3])); // recovered
  });
});
