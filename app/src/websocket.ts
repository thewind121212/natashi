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
  private webMode: boolean;
  private isPaused = false;
  private isStreamReady = false;
  private playRequestId = 0;
  private activePlayRequestId = 0;
  private playbackStartAt: number | null = null;
  private playbackOffsetSec = 0;
  private pendingTransitionTimer: NodeJS.Timeout | null = null;
  private pendingTransitionRequestId = 0;
  private suppressAutoAdvanceFor: Set<string> = new Set();

  private static readonly TRANSITION_DEBOUNCE_MS = 150;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server });
    this.socketClient = new SocketClient();
    this.apiClient = new ApiClient();
    this.audioPlayer = new AudioPlayer();
    this.queueManager = new QueueManager();
    this.debugMode = process.env.DEBUG_AUDIO === '1';
    this.webMode = process.env.WEB_AUDIO === '1';
    if (this.webMode) {
      console.log('[WebSocket] Web audio mode enabled via WEB_AUDIO=1');
    } else if (this.debugMode) {
      console.log('[WebSocket] Debug mode enabled via DEBUG_AUDIO=1');
    }
    this.setupWebSocket();
    this.setupAudioPlayer();
    this.setupQueueManager();
  }

  private log(source: 'go' | 'nodejs', message: string): void {
    // Web mode: silent operation - focus on music playback only
    if (this.webMode) return;

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
        webMode: this.webMode,
        isPaused: this.isPaused,
        isPlaying: this.currentSessionId !== null,
        session_id: this.currentSessionId ?? undefined,
        playback_secs: this.getPlaybackSeconds(),
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

        // Route audio based on mode
        if (this.webMode && this.isStreamReady) {
          // Web mode: pass through to browser (client handles buffering)
          this.broadcastBinary(data);
        } else if (this.debugMode && this.isStreamReady) {
          // Debug mode: play PCM via ffplay
          this.audioPlayer.write(data);
        }

        // Update browser with progress every ~100KB
        // Note: Progress tracking in web mode is done by browser's audio player
        if (!this.webMode && this.bytesReceived % 100000 < data.length) {
          const playbackSecs = this.bytesReceived / 192000; // PCM: 48kHz * 2ch * 2bytes
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
    this.playbackStartAt = null;
    this.playbackOffsetSec = 0;
    if (this.pendingTransitionTimer) {
      clearTimeout(this.pendingTransitionTimer);
      this.pendingTransitionTimer = null;
    }
    this.pendingTransitionRequestId = 0;
  }

  private getPlaybackSeconds(): number {
    if (this.playbackStartAt) {
      return this.playbackOffsetSec + (Date.now() - this.playbackStartAt) / 1000;
    }
    return this.playbackOffsetSec;
  }

  private async abortCurrentPlayback(): Promise<void> {
    if (this.currentSessionId) {
      this.suppressAutoAdvanceFor.add(this.currentSessionId);
      try {
        await this.apiClient.stop(this.currentSessionId);
      } catch (err) {
        this.log('nodejs', `Stop error (ignored): ${err}`);
      }
    }
    this.resetPlaybackState();
  }

  private scheduleTransition(requestId: number, action: () => Promise<void>): void {
    if (this.pendingTransitionTimer) {
      clearTimeout(this.pendingTransitionTimer);
    }
    this.pendingTransitionRequestId = requestId;
    this.pendingTransitionTimer = setTimeout(() => {
      this.pendingTransitionTimer = null;
      if (requestId !== this.activePlayRequestId || requestId !== this.pendingTransitionRequestId) {
        return;
      }
      action().catch((err) => {
        this.log('nodejs', `Transition error: ${err}`);
      });
    }, WebSocketHandler.TRANSITION_DEBOUNCE_MS);
  }

  private async handlePlayUrl(url: string, requestId: number): Promise<void> {
    const nowPlaying = this.queueManager.getCurrentTrack();
    if (this.currentSessionId && nowPlaying && this.extractVideoId(nowPlaying.url) === this.extractVideoId(url)) {
      this.log('nodejs', 'Same video already playing, ignoring');
      return;
    }

    await this.abortCurrentPlayback();

    // Check if it's the same video already playing
    // Fetch metadata to check if it's a playlist
    try {
      const metadata = await this.apiClient.getMetadata(url);
      if (requestId !== this.activePlayRequestId) return;

      if (metadata.is_playlist) {
        // It's a playlist - extract all videos and add to queue
        this.log('nodejs', 'Detected playlist, extracting videos...');
        this.broadcastJson({ type: 'status', message: 'Loading playlist...' });

        const playlist = await this.apiClient.getPlaylist(url);
        if (requestId !== this.activePlayRequestId) return;
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

        const firstTrack = this.queueManager.startPlaying(0);
        if (firstTrack) {
          this.broadcastJson({
            type: 'nowPlaying',
            nowPlaying: firstTrack,
          });
          await this.playTrack(firstTrack.url, requestId);
        }
      } else {
        // Single video - add to queue and play
        this.queueManager.addTrack(
          url,
          metadata.title,
          metadata.duration,
          metadata.thumbnail
        );

        const track = this.queueManager.startPlaying(this.queueManager.getQueue().length - 1);
        if (track) {
          this.broadcastJson({
            type: 'nowPlaying',
            nowPlaying: track,
          });
          await this.playTrack(track.url, requestId);
        }
      }
    } catch (err) {
      this.log('nodejs', `Failed to process URL: ${err}`);
      this.broadcastJson({ type: 'error', message: `Failed to process URL: ${err}` });
    }
  }

  private async handlePlayFromQueue(index: number, requestId: number): Promise<void> {
    if (this.currentSessionId && index === this.queueManager.getState().currentIndex) {
      this.log('nodejs', 'Same queue index already playing, ignoring');
      return;
    }

    await this.abortCurrentPlayback();

    // Now update queue and get track
    const track = this.queueManager.startPlaying(index);
    if (track) {
      this.log('nodejs', `Playing from queue: ${track.title}`);

      // Broadcast now playing
      this.broadcastJson({
        type: 'nowPlaying',
        nowPlaying: track,
      });

      await this.playTrack(track.url, requestId);
    } else {
      this.log('nodejs', `Invalid queue index: ${index}`);
    }
  }

  private async handleSkip(requestId: number): Promise<void> {
    await this.abortCurrentPlayback();

    const nextTrack = this.queueManager.skip();
    if (nextTrack) {
      await this.playTrack(nextTrack.url, requestId);
    } else {
      this.log('nodejs', 'No more tracks in queue');
      this.broadcastJson({ type: 'queueFinished' });
    }
  }

  private async handlePrevious(requestId: number): Promise<void> {
    await this.abortCurrentPlayback();

    const prevTrack = this.queueManager.previous();
    if (prevTrack) {
      await this.playTrack(prevTrack.url, requestId);
    } else {
      this.log('nodejs', 'Already at start of queue');
    }
  }

  private async playTrack(url: string, requestId: number): Promise<void> {
    // Generate new session ID
    const sessionId = generateSessionId();
    this.currentSessionId = sessionId;

    // Reset state for new session
    this.bytesReceived = 0;
    this.isPaused = false;
    this.isStreamReady = false;
    this.playbackStartAt = null;
    this.playbackOffsetSec = 0;

    this.log('nodejs', `New session: ${sessionId.slice(0, 8)}...`);
    this.log('nodejs', `Starting playback: ${url}`);

    try {
      // Select format based on mode: web (Opus 256kbps) or pcm (debug)
      const format = this.webMode ? 'web' : 'pcm';
      const result = await this.apiClient.play(sessionId, url, format);
      if (requestId !== this.activePlayRequestId) {
        this.log('nodejs', 'Stale play request, stopping session');
        try {
          await this.apiClient.stop(sessionId);
        } catch {
          // Ignore stop errors for stale sessions
        }
        if (this.currentSessionId === sessionId) {
          this.currentSessionId = null;
        }
        return;
      }
      this.log('go', `Play response: ${result.status} (format: ${format})`);
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
        if (!this.isPaused) {
          this.playbackStartAt = Date.now();
        }
        if (this.debugMode && !this.webMode && !this.isPaused) {
          this.audioPlayer.start();
        }
        this.broadcastJson(event);
        break;

      case 'finished':
        this.log('go', `Stream finished, total: ${this.bytesReceived} bytes`);
        if (this.debugMode && !this.webMode) {
          this.audioPlayer.end();
        }
        this.currentSessionId = null;
        this.isStreamReady = false;
        this.playbackStartAt = null;
        this.playbackOffsetSec = 0;
        this.broadcastJson({ ...event, bytes: this.bytesReceived });

        if (event.session_id && this.suppressAutoAdvanceFor.has(event.session_id)) {
          this.suppressAutoAdvanceFor.delete(event.session_id);
          this.log('nodejs', 'Auto-advance suppressed for stopped session');
          break;
        }

        // Auto-advance to next track in queue
        const nextTrack = this.queueManager.currentFinished();
        if (nextTrack) {
          this.log('nodejs', `Auto-advancing to next track: ${nextTrack.title}`);
          const requestId = ++this.playRequestId;
          this.activePlayRequestId = requestId;
          this.playTrack(nextTrack.url, requestId);
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
        const requestId = ++this.playRequestId;
        this.activePlayRequestId = requestId;
        const url = message.url.trim();

        this.scheduleTransition(requestId, () => this.handlePlayUrl(url, requestId));

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
              const requestId = ++this.playRequestId;
              this.activePlayRequestId = requestId;
              await this.playTrack(track.url, requestId);
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

      } else if (message.action === 'playFromQueue' && typeof message.index === 'number') {
        const requestId = ++this.playRequestId;
        this.activePlayRequestId = requestId;
        // Play specific track from queue
        this.log('nodejs', `playFromQueue: index=${message.index}`);

        this.scheduleTransition(requestId, () => this.handlePlayFromQueue(message.index, requestId));

      } else if (message.action === 'skip') {
        const requestId = ++this.playRequestId;
        this.activePlayRequestId = requestId;
        // Skip to next track
        this.log('nodejs', 'Skip requested');

        this.scheduleTransition(requestId, () => this.handleSkip(requestId));

      } else if (message.action === 'previous') {
        const requestId = ++this.playRequestId;
        this.activePlayRequestId = requestId;
        // Go to previous track
        this.log('nodejs', 'Previous requested');

        this.scheduleTransition(requestId, () => this.handlePrevious(requestId));

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
          if (this.playbackStartAt) {
            this.playbackOffsetSec += (Date.now() - this.playbackStartAt) / 1000;
            this.playbackStartAt = null;
          }
          // Set flag FIRST - stops audio processing immediately
          this.isPaused = true;

          // Stop audio player immediately (kills ffplay) - only in debug mode
          if (this.debugMode && !this.webMode) {
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
          this.playbackStartAt = Date.now();
          // Tell Go to resume FIRST (it needs to start sending chunks)
          const sessionId = this.currentSessionId;
          this.apiClient.resume(sessionId).then(() => {
            this.log('nodejs', 'Playback resumed');
          }).catch((err) => {
            this.log('nodejs', `Resume API error: ${err}`);
          });

          // Set flag and start audio player (only in debug mode, not web mode)
          this.isPaused = false;
          if (this.debugMode && !this.webMode && this.isStreamReady) {
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

  private broadcastBinary(data: Buffer): void {
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data, { binary: true });
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
