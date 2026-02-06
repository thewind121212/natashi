import * as net from 'net';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

const SOCKET_PATH = '/tmp/music-playground.sock';

// Jitter buffer configuration
const JITTER_BUFFER_SIZE = 5;      // Buffer 5 frames before starting playback
const FRAME_INTERVAL_MS = 20;       // Output a frame every 20ms (Discord Opus standard)

/**
 * JitterBuffer smooths out variable audio chunk arrival times.
 * Buffers incoming chunks and outputs them at consistent intervals.
 */
class JitterBuffer {
  private chunks: Buffer[] = [];
  private outputStream: PassThrough;
  private interval: NodeJS.Timeout | null = null;
  private started = false;
  private underruns = 0;
  private consecutiveUnderruns = 0;
  private totalFrames = 0;

  constructor(outputStream: PassThrough) {
    this.outputStream = outputStream;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);

    // Start outputting once we have enough buffered frames
    if (!this.started && this.chunks.length >= JITTER_BUFFER_SIZE) {
      this.start();
    }
  }

  private start(): void {
    if (this.started) return;
    this.started = true;

    this.interval = setInterval(() => {
      this.outputFrame();
    }, FRAME_INTERVAL_MS);
  }

  private outputFrame(): void {
    if (this.outputStream.destroyed) {
      this.stop();
      return;
    }

    const chunk = this.chunks.shift();
    if (chunk) {
      // Got data - reset consecutive counter, log recovery if needed
      if (this.consecutiveUnderruns >= 10) {
        console.log(`[JitterBuffer] Recovered after ${this.consecutiveUnderruns} underruns`);
      }
      this.consecutiveUnderruns = 0;
      this.totalFrames++;
      this.outputStream.push(chunk);
    } else {
      // Buffer underrun
      this.underruns++;
      this.consecutiveUnderruns++;
      // Only log if sustained underrun (10+ consecutive = 200ms gap)
      if (this.consecutiveUnderruns === 10) {
        console.log(`[JitterBuffer] Sustained underrun detected (buffer starved)`);
      }
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.started = false;
    this.chunks = [];
    // Only log if underruns were significant (>1% of frames)
    if (this.totalFrames > 0 && this.underruns > this.totalFrames * 0.01) {
      console.log(`[JitterBuffer] Session end: ${this.underruns} underruns / ${this.totalFrames} frames (${(this.underruns / this.totalFrames * 100).toFixed(1)}%)`);
    }
    this.underruns = 0;
    this.consecutiveUnderruns = 0;
    this.totalFrames = 0;
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

    // Clean up when stream is destroyed
    stream.on('close', () => {
      this.sessionStreams.delete(sessionId);
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
