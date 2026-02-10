import * as net from 'net';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

const SOCKET_PATH = '/tmp/music-playground.sock';

// Prebuffer configuration
const PREBUFFER_SIZE = 25; // Buffer 25 frames (500ms) before starting playback

/**
 * JitterBuffer prebuffers incoming audio chunks before letting Discord consume them.
 * After prebuffer fills, chunks pass straight through — Discord's own 20ms reader handles pacing.
 * No setInterval needed; Discord is the sole timing authority.
 */
class JitterBuffer {
  private outputStream: PassThrough;
  private started = false;
  private prebuffer: Buffer[] = [];
  private lastPushTime = 0;

  constructor(outputStream: PassThrough) {
    this.outputStream = outputStream;
  }

  push(chunk: Buffer): void {
    if (this.outputStream.destroyed) return;

    if (!this.started) {
      this.prebuffer.push(chunk);
      if (this.prebuffer.length >= PREBUFFER_SIZE) {
        this.started = true;
        for (const buffered of this.prebuffer) {
          this.outputStream.push(buffered);
        }
        this.prebuffer = [];
        this.lastPushTime = Date.now();
      }
      return;
    }

    // Stutter detection: log when gap between chunks exceeds 100ms (5x normal 20ms)
    const now = Date.now();
    if (this.lastPushTime > 0) {
      const gap = now - this.lastPushTime;
      if (gap > 100) {
        console.log(`[Stutter] Audio gap detected: ${gap}ms since last chunk (expected ~20ms)`);
      }
    }
    this.lastPushTime = now;

    this.outputStream.push(chunk);
  }

  stop(): void {
    this.started = false;
    this.prebuffer = [];
    this.lastPushTime = 0;
  }
}

export interface Event {
  type: 'ready' | 'error' | 'finished';
  session_id: string;
  duration?: number;
  message?: string;
}

// SocketClient handles Unix socket connection for receiving audio data.
// Control commands are now handled via HTTP API (see api-client.ts).
// Session-specific audio stream with optional jitter buffer
interface SessionStream {
  stream: PassThrough;
  jitterBuffer: JitterBuffer | null;  // null for direct pass-through (Ogg/Opus containers)
}

export class SocketClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected = false;
  private buffer = Buffer.alloc(0);
  private readingAudio = false;
  private audioLength = 0;
  // Per-session audio streams (keyed by sessionId)
  private sessionStreams = new Map<string, SessionStream>();

  // Singleton instance for shared access
  private static instance: SocketClient | null = null;

  static getSharedInstance(): SocketClient {
    if (!SocketClient.instance) {
      SocketClient.instance = new SocketClient();
    }
    return SocketClient.instance;
  }

  connect(): Promise<void> {
    // Idempotent: return immediately if already connected
    if (this.connected && this.socket) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(SOCKET_PATH, () => {
        console.log('[SocketClient] Connected to Go server (audio)');
        this.connected = true;
        resolve();
      });

      this.socket.on('error', (err) => {
        console.error('[SocketClient] Error:', err.message);
        this.connected = false;
        if (!this.connected) {
          reject(err);
        }
        this.emit('error', err);
      });

      this.socket.on('close', () => {
        console.log('[SocketClient] Disconnected');
        this.connected = false;
        // Clean up all session streams on disconnect
        this.endAllAudioStreams();
        this.emit('close');
      });

      this.socket.on('data', (data) => this.handleData(data));
    });
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      if (this.readingAudio) {
        // Reading binary audio data (24-byte session ID + audio)
        if (this.buffer.length >= this.audioLength) {
          const SESSION_ID_LEN = 24;
          // Defensive check: packet must be at least 24 bytes for session ID
          if (this.audioLength < SESSION_ID_LEN) {
            console.error(`[SocketClient] Malformed packet: length ${this.audioLength} < ${SESSION_ID_LEN}`);
            this.buffer = this.buffer.subarray(this.audioLength);
            this.readingAudio = false;
            continue; // Skip malformed packet
          }
          const sessionId = this.buffer.subarray(0, SESSION_ID_LEN).toString('utf8').trim();
          const audioData = this.buffer.subarray(SESSION_ID_LEN, this.audioLength);
          this.buffer = this.buffer.subarray(this.audioLength);
          this.readingAudio = false;
          this.emit('audio', { sessionId, data: audioData });
          // Route to session-specific stream if exists
          this.routeAudioToSession(sessionId, audioData);
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
        // Audio header: 4 bytes length (big-endian)
        // JSON starts with '{'

        if (this.buffer[0] === 0x7b) { // '{' character
          // Try to parse JSON
          const newlineIdx = this.buffer.indexOf('\n');
          const endIdx = newlineIdx >= 0 ? newlineIdx : this.buffer.indexOf('}') + 1;

          if (endIdx > 0) {
            try {
              // Find complete JSON object
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
                const event: Event = JSON.parse(jsonStr);
                this.emit('event', event);
              } else {
                break; // Need more data
              }
            } catch {
              // Not valid JSON yet, wait for more data
              break;
            }
          } else {
            break; // Need more data
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

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Route audio data to session-specific stream
  private routeAudioToSession(sessionId: string, data: Buffer): void {
    const session = this.sessionStreams.get(sessionId);
    if (session) {
      // Check if stream was closed by Discord (happens when stream is empty during yt-dlp extraction)
      if (session.stream.writableEnded || session.stream.destroyed) {
        const newStream = new PassThrough();
        session.stream = newStream;
      }

      if (session.jitterBuffer) {
        // Use jitter buffer for PCM/raw frame streams
        session.jitterBuffer.push(data);
      } else {
        // Direct pass-through for container formats (Ogg/Opus)
        session.stream.push(data);
      }
    }
  }

  // Create a PassThrough stream for a specific session (Discord guild or user)
  createAudioStreamForSession(sessionId: string): PassThrough {
    // End previous stream for this session if exists
    this.endAudioStreamForSession(sessionId);

    const stream = new PassThrough();
    const jitterBuffer = new JitterBuffer(stream);

    this.sessionStreams.set(sessionId, { stream, jitterBuffer });

    // Clean up when stream is destroyed
    stream.on('close', () => {
      const session = this.sessionStreams.get(sessionId);
      if (session) {
        if (session.jitterBuffer) {
          session.jitterBuffer.stop();
        }
        this.sessionStreams.delete(sessionId);
      }
    });

    return stream;
  }

  // Create a direct PassThrough stream (no jitter buffer) for container formats like Ogg/Opus.
  // Use this for Discord playback where the Ogg container handles its own framing.
  createDirectStreamForSession(sessionId: string): PassThrough {
    // End previous stream for this session if exists
    this.endAudioStreamForSession(sessionId);

    const stream = new PassThrough();

    this.sessionStreams.set(sessionId, { stream, jitterBuffer: null });

    // Note: Don't delete from map on 'close' - Discord may close empty streams early
    // while waiting for Go to start sending data. Cleanup is done explicitly via
    // endAudioStreamForSession() when track finishes or changes.
    stream.on('error', (err) => {
      console.error(`[SocketClient] Stream ERROR for session "${sessionId}":`, err.message);
    });

    return stream;
  }

  // End audio stream for a specific session
  endAudioStreamForSession(sessionId: string): void {
    const session = this.sessionStreams.get(sessionId);
    if (session) {
      if (session.jitterBuffer) {
        session.jitterBuffer.stop();
      }
      session.stream.end();
      this.sessionStreams.delete(sessionId);
    }
  }

  // Gracefully end stream for a session (signal no more data, but let Discord consume buffer)
  // Use this for auto-advance to prevent cutting off remaining buffered audio.
  // The stream will be cleaned up when the next track starts or when endAudioStreamForSession is called.
  gracefulEndStreamForSession(sessionId: string): void {
    const session = this.sessionStreams.get(sessionId);
    if (session) {
      // Just signal end of data - don't stop jitter buffer or delete from map yet
      // Discord player will continue consuming buffered data until it goes Idle
      if (!session.stream.writableEnded) {
        session.stream.end();
      }
      // Note: Don't delete from map - cleanup happens when next track starts
      // or when endAudioStreamForSession is called explicitly
    }
  }

  // End all audio streams (cleanup)
  endAllAudioStreams(): void {
    for (const [, session] of this.sessionStreams) {
      if (session.jitterBuffer) {
        session.jitterBuffer.stop();
      }
      session.stream.end();
    }
    this.sessionStreams.clear();
  }
}
