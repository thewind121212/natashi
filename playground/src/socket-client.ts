import * as net from 'net';
import { EventEmitter } from 'events';

const SOCKET_PATH = '/tmp/music-playground.sock';

export interface Command {
  type: 'play' | 'stop';
  session_id: string;
  url?: string;
  format?: 'pcm' | 'webm' | 'raw';
}

export interface Event {
  type: 'ready' | 'error' | 'finished';
  session_id: string;
  duration?: number;
  message?: string;
}

export class SocketClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected = false;
  private buffer = Buffer.alloc(0);
  private readingAudio = false;
  private audioLength = 0;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(SOCKET_PATH, () => {
        console.log('[SocketClient] Connected to Go server');
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
        // Reading binary audio data
        if (this.buffer.length >= this.audioLength) {
          const audioData = this.buffer.subarray(0, this.audioLength);
          this.buffer = this.buffer.subarray(this.audioLength);
          this.readingAudio = false;
          this.emit('audio', audioData);
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

  send(command: Command): void {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected');
    }
    const json = JSON.stringify(command);
    this.socket.write(json);
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
}
