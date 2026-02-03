import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer, RawData } from 'ws';
import { SocketClient, Event } from './socket-client';
import { ApiClient } from './api-client';
import { AudioPlayer } from './audio-player';
import { QueueManager, QueueState } from './queue-manager';

export class WebSocketHandler {
  private wss: WebSocketServer;
  private socketClient: SocketClient;
  private apiClient: ApiClient;
  private audioPlayer: AudioPlayer;
  private queueManager: QueueManager;
  private clients: Set<WebSocket> = new Set();
  private currentSessionId: string | null = null;
  private bytesReceived = 0;
  private debugMode: boolean;
  private isPaused = false;
  private isStreamReady = false;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server });
    this.socketClient = new SocketClient();
    this.apiClient = new ApiClient();
    this.audioPlayer = new AudioPlayer();
    this.queueManager = new QueueManager();
    this.debugMode = process.env.DEBUG_AUDIO === '1';
    if (this.debugMode) {
      console.log('[WebSocket] Debug mode enabled via DEBUG_AUDIO=1');
    }
    this.setupWebSocket();
    this.setupAudioPlayer();
    this.setupQueueManager();
  }

  private log(source: 'go' | 'nodejs', message: string): void {
    console.log(`[${source === 'go' ? 'Go' : 'Node'}] ${message}`);
    this.broadcastJson({ type: 'log', source, message });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      this.log('nodejs', 'Browser connected');
      this.clients.add(ws);

      ws.send(JSON.stringify({
        type: 'state',
        debugMode: this.debugMode,
        isPaused: this.isPaused,
        isPlaying: this.currentSessionId !== null,
        ...this.queueManager.getState(),
      }));

      ws.on('message', (data) => this.handleBrowserMessage(ws, data));
      ws.on('close', () => {
        this.log('nodejs', 'Browser disconnected');
        this.clients.delete(ws);
      });
      ws.on('error', (err) => {
        this.log('nodejs', `WebSocket error: ${err.message}`);
      });
    });
  }

  private setupAudioPlayer(): void {
    this.audioPlayer.on('stopped', () => {
      // Don't broadcast - we handle state manually
    });

    this.audioPlayer.on('error', (err: Error) => {
      this.log('nodejs', `Audio player error: ${err.message}`);
    });
  }

  private setupQueueManager(): void {
    this.queueManager.on('update', (state: QueueState) => {
      this.broadcastJson({
        type: 'queueUpdated',
        queue: state.queue,
        currentIndex: state.currentIndex,
        nowPlaying: state.nowPlaying,
      });
    });
  }

  async connect(): Promise<void> {
    // First check if Go API is healthy
    try {
      const health = await this.apiClient.health();
      this.log('nodejs', `Go API health: ${health.status}`);
    } catch (err) {
      throw new Error('Go API not available. Start Go server first.');
    }

    // Then connect socket for audio
    try {
      await this.socketClient.connect();
      this.log('nodejs', 'Connected to Go socket (audio)');

      this.socketClient.on('event', (event: Event) => {
        this.handleGoEvent(event);
      });

      this.socketClient.on('audio', (data: Buffer) => {
        // Skip if paused or no active session
        if (this.isPaused || !this.currentSessionId) {
          return;
        }

        this.bytesReceived += data.length;

        // Log first audio chunk
        if (this.bytesReceived === data.length) {
          this.log('nodejs', `First audio chunk: ${data.length} bytes, streamReady=${this.isStreamReady}`);
        }

        // Play audio if debug mode is enabled and stream is ready
        if (this.debugMode && this.isStreamReady) {
          this.audioPlayer.write(data);
        }

        // Update browser with progress every ~100KB
        if (this.bytesReceived % 100000 < data.length) {
          const playbackSecs = this.bytesReceived / 192000;
          this.broadcastJson({
            type: 'progress',
            bytes: this.bytesReceived,
            playback_secs: playbackSecs,
          });
        }
      });

      this.socketClient.on('close', () => {
        this.log('go', 'Socket connection closed');
        this.resetPlaybackState();
        this.broadcastJson({ type: 'error', session_id: '', message: 'Server disconnected' });
      });

    } catch (err) {
      this.log('nodejs', `Failed to connect to Go socket: ${err}`);
      throw err;
    }
  }

  private resetPlaybackState(): void {
    this.audioPlayer.stop();
    this.currentSessionId = null;
    this.isPaused = false;
    this.isStreamReady = false;
    this.bytesReceived = 0;
  }

  private async playTrack(url: string): Promise<void> {
    // Stop current session if any
    if (this.currentSessionId) {
      try {
        await this.apiClient.stop(this.currentSessionId);
      } catch (err) {
        this.log('nodejs', `Stop error (ignored): ${err}`);
      }
      this.audioPlayer.stop();
    }

    // Reset state for new session
    this.bytesReceived = 0;
    this.isPaused = false;
    this.isStreamReady = false;

    // Generate new session ID
    const sessionId = generateSessionId();
    this.currentSessionId = sessionId;

    this.log('nodejs', `New session: ${sessionId.slice(0, 8)}...`);
    this.log('nodejs', `Starting playback: ${url}`);

    try {
      const result = await this.apiClient.play(sessionId, url, 'pcm');
      this.log('go', `Play response: ${result.status}`);
      this.broadcastJson({ type: 'session', session_id: sessionId });
    } catch (err) {
      this.log('nodejs', `Play error: ${err}`);
      this.currentSessionId = null;
      this.broadcastJson({ type: 'error', session_id: sessionId, message: `${err}` });
    }
  }

  private handleGoEvent(event: Event): void {
    // IMPORTANT: Ignore events from old sessions
    const eventSessionShort = event.session_id ? event.session_id.slice(0, 8) : 'none';
    const currentSessionShort = this.currentSessionId ? this.currentSessionId.slice(0, 8) : 'none';

    this.log('go', `Event: ${event.type} (event=${eventSessionShort}, current=${currentSessionShort})`);

    if (event.session_id && this.currentSessionId && event.session_id !== this.currentSessionId) {
      this.log('go', `Ignoring - session mismatch`);
      return;
    }

    switch (event.type) {
      case 'ready':
        this.isStreamReady = true;
        this.log('nodejs', `Ready received: debugMode=${this.debugMode}, isPaused=${this.isPaused}`);
        if (this.debugMode && !this.isPaused) {
          this.log('nodejs', 'Starting audio player');
          this.audioPlayer.start();
        }
        this.broadcastJson(event);
        break;

      case 'finished':
        this.log('go', `Stream finished, total: ${this.bytesReceived} bytes`);
        if (this.debugMode) {
          this.audioPlayer.end();
        }
        this.currentSessionId = null;
        this.isStreamReady = false;
        this.broadcastJson({ ...event, bytes: this.bytesReceived });

        // Auto-advance to next track in queue
        const nextTrack = this.queueManager.currentFinished();
        if (nextTrack) {
          this.log('nodejs', `Auto-advancing to next track: ${nextTrack.title}`);
          this.playTrack(nextTrack.url);
        } else {
          this.log('nodejs', 'Queue finished');
          this.broadcastJson({ type: 'queueFinished' });
        }
        break;

      case 'error':
        this.log('go', `Error: ${event.message}`);
        this.resetPlaybackState();
        this.broadcastJson(event);
        break;

      default:
        this.broadcastJson(event);
    }
  }

  private async handleBrowserMessage(ws: WebSocket, data: RawData): Promise<void> {
    try {
      const message = JSON.parse(data.toString());
      this.log('nodejs', `Browser action: ${message.action || message.type}`);

      if (message.action === 'play' && message.url) {
        const url = message.url.trim();

        // Check if it's the same video already playing
        const nowPlaying = this.queueManager.getCurrentTrack();
        if (nowPlaying && this.extractVideoId(nowPlaying.url) === this.extractVideoId(url)) {
          this.log('nodejs', 'Same video already playing, ignoring');
          return;
        }

        // Fetch metadata to check if it's a playlist
        try {
          const metadata = await this.apiClient.getMetadata(url);

          if (metadata.is_playlist) {
            // It's a playlist - extract all videos and add to queue
            this.log('nodejs', 'Detected playlist, extracting videos...');
            this.broadcastJson({ type: 'status', message: 'Loading playlist...' });

            const playlist = await this.apiClient.getPlaylist(url);
            if (playlist.error) {
              this.broadcastJson({ type: 'error', message: playlist.error });
              return;
            }

            this.log('nodejs', `Found ${playlist.count} videos in playlist`);

            // Add all videos to queue
            for (const entry of playlist.entries) {
              this.queueManager.addTrack(
                entry.url,
                entry.title,
                entry.duration,
                entry.thumbnail
              );
            }

            // Start playing first track if not already playing
            if (!this.currentSessionId) {
              const firstTrack = this.queueManager.startPlaying(0);
              if (firstTrack) {
                this.broadcastJson({
                  type: 'nowPlaying',
                  nowPlaying: firstTrack,
                });
                await this.playTrack(firstTrack.url);
              }
            }
          } else {
            // Single video - add to queue and play
            this.queueManager.addTrack(
              url,
              metadata.title,
              metadata.duration,
              metadata.thumbnail
            );

            // If nothing is playing, start playing this track
            if (!this.currentSessionId) {
              const track = this.queueManager.startPlaying(this.queueManager.getQueue().length - 1);
              if (track) {
                this.broadcastJson({
                  type: 'nowPlaying',
                  nowPlaying: track,
                });
                await this.playTrack(track.url);
              }
            } else {
              this.log('nodejs', `Added to queue: ${metadata.title}`);
            }
          }
        } catch (err) {
          this.log('nodejs', `Failed to process URL: ${err}`);
          this.broadcastJson({ type: 'error', message: `Failed to process URL: ${err}` });
        }

      } else if (message.action === 'addToQueue' && message.url) {
        // Add to queue
        this.log('nodejs', `Adding to queue: ${message.url}`);
        try {
          const metadata = await this.apiClient.getMetadata(message.url);
          if (metadata.error) {
            this.broadcastJson({ type: 'error', message: metadata.error });
            return;
          }
          this.queueManager.addTrack(
            message.url,
            metadata.title,
            metadata.duration,
            metadata.thumbnail
          );
          this.log('nodejs', `Added to queue: ${metadata.title}`);

          // If nothing is playing, start playing
          if (!this.currentSessionId) {
            const track = this.queueManager.startPlaying(0);
            if (track) {
              await this.playTrack(track.url);
            }
          }
        } catch (err) {
          this.log('nodejs', `Failed to get metadata: ${err}`);
          this.broadcastJson({ type: 'error', message: `Failed to get metadata: ${err}` });
        }

      } else if (message.action === 'removeFromQueue' && typeof message.index === 'number') {
        // Remove from queue
        const removed = this.queueManager.removeTrack(message.index);
        if (removed) {
          this.log('nodejs', `Removed track at index ${message.index}`);
        }

      } else if (message.action === 'skip') {
        // Skip to next track
        this.log('nodejs', 'Skip requested');
        if (this.currentSessionId) {
          try {
            await this.apiClient.stop(this.currentSessionId);
          } catch (err) {
            this.log('nodejs', `Stop error: ${err}`);
          }
        }
        this.resetPlaybackState();

        const nextTrack = this.queueManager.skip();
        if (nextTrack) {
          await this.playTrack(nextTrack.url);
        } else {
          this.log('nodejs', 'No more tracks in queue');
          this.broadcastJson({ type: 'queueFinished' });
        }

      } else if (message.action === 'clearQueue') {
        // Clear queue and stop
        this.log('nodejs', 'Clearing queue');
        if (this.currentSessionId) {
          try {
            await this.apiClient.stop(this.currentSessionId);
          } catch (err) {
            this.log('nodejs', `Stop error: ${err}`);
          }
        }
        this.resetPlaybackState();
        this.queueManager.clear();
        this.broadcastJson({ type: 'stopped' });

      } else if (message.action === 'getQueue') {
        // Return current queue state
        ws.send(JSON.stringify({
          type: 'queueUpdated',
          ...this.queueManager.getState(),
        }));

      } else if (message.action === 'stop') {
        if (this.currentSessionId) {
          this.log('go', 'Stop command sent');
          try {
            await this.apiClient.stop(this.currentSessionId);
          } catch (err) {
            this.log('nodejs', `Stop error: ${err}`);
          }
        }
        this.resetPlaybackState();
        this.broadcastJson({ type: 'stopped' });

      } else if (message.action === 'pause') {
        if (this.currentSessionId && !this.isPaused) {
          // Set flag FIRST - stops audio processing immediately
          this.isPaused = true;

          // Stop audio player immediately (kills ffplay)
          if (this.debugMode) {
            this.audioPlayer.stop();
          }

          // Broadcast immediately for responsive UI
          this.broadcastJson({ type: 'paused' });
          this.log('nodejs', 'Playback paused');

          // Tell Go to pause (non-blocking - audio already stopped locally)
          this.apiClient.pause(this.currentSessionId).catch((err) => {
            this.log('nodejs', `Pause API error: ${err}`);
          });
        }

      } else if (message.action === 'resume') {
        if (this.currentSessionId && this.isPaused) {
          // Tell Go to resume FIRST (it needs to start sending chunks)
          const sessionId = this.currentSessionId;
          this.apiClient.resume(sessionId).then(() => {
            this.log('nodejs', 'Playback resumed');
          }).catch((err) => {
            this.log('nodejs', `Resume API error: ${err}`);
          });

          // Set flag and start audio player
          this.isPaused = false;
          if (this.debugMode && this.isStreamReady) {
            this.audioPlayer.start();
          }

          this.broadcastJson({ type: 'resumed' });
        }
      }
    } catch (err) {
      this.log('nodejs', `Error handling message: ${err}`);
    }
  }

  private broadcastJson(data: object): void {
    const json = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(json);
      }
    }
  }

  // Extract YouTube video ID from various URL formats
  private extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  isConnected(): boolean {
    return this.socketClient.isConnected();
  }
}

function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
