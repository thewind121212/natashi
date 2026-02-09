import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer, RawData } from 'ws';
import { parse as parseCookie } from 'cookie';
import * as YouTubeSearch from 'youtube-search-api';
import { SocketClient, Event } from './socket-client';
import { ApiClient } from './api-client';
import { AudioPlayer } from './audio-player';
import { QueueState } from './queue-manager';
import { SessionStore, UserSession } from './session-store';
import { SqliteStore } from './sqlite-store';
import { verifyToken, JwtPayload } from './auth/jwt';
import { config } from './config';
import { isSpotifyUrl, isSpotifySearchUrl, getSpotifyTracks, buildSpotifySearchUrl, resolveSpotifySearch } from './spotify-resolver';

// Parse duration string like "3:45" or "1:23:45" to seconds
function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

interface FastMetadata {
  title: string;
  duration: number;
  thumbnail: string;
  is_playlist?: boolean;
}

// Get fast metadata using youtube-search-api
async function getFastMetadata(url: string, videoId: string | null): Promise<FastMetadata | null> {
  if (!videoId) return null;
  try {
    const searchResults = await YouTubeSearch.GetListByKeyword(videoId, false, 5);
    const items = searchResults?.items as Array<{ id: string; type: string; title: string; length?: { simpleText: string } }> | undefined;
    const video = items?.find((item) => item.type === 'video' && item.id === videoId);
    if (video) {
      return {
        title: video.title || 'Unknown',
        duration: parseDuration(video.length?.simpleText || ''),
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }
    const firstVideo = items?.find((item) => item.type === 'video');
    if (firstVideo) {
      return {
        title: firstVideo.title || 'Unknown',
        duration: parseDuration(firstVideo.length?.simpleText || ''),
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }
    return null;
  } catch {
    return { title: 'Loading...', duration: 0, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  }
}

interface PlaylistEntry {
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
}

// Get playlist data using youtube-search-api
async function getFastPlaylist(playlistId: string): Promise<{ entries: PlaylistEntry[]; count: number; error?: string }> {
  try {
    const data = await YouTubeSearch.GetPlaylistData(playlistId, 200);
    if (!data?.items?.length) {
      return { entries: [], count: 0, error: 'Playlist is empty or not found' };
    }
    const entries: PlaylistEntry[] = [];
    for (const item of data.items as Array<{ id: string; title: string; length?: { simpleText: string } }>) {
      if (item.id) {
        entries.push({
          url: `https://www.youtube.com/watch?v=${item.id}`,
          title: item.title || 'Unknown',
          duration: parseDuration(item.length?.simpleText || ''),
          thumbnail: `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
        });
      }
    }
    return { entries, count: entries.length };
  } catch (error) {
    console.error('[WebSocket] Playlist extraction error:', error);
    return { entries: [], count: 0, error: 'Failed to load playlist' };
  }
}

interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
}

export class WebSocketHandler {
  private wss: WebSocketServer;
  private socketClient: SocketClient;
  private apiClient: ApiClient;
  private audioPlayer: AudioPlayer;
  private sessionStore: SessionStore;
  private clients: Map<WebSocket, string> = new Map(); // ws -> userId
  private debugMode: boolean;
  private webMode: boolean;

  private static readonly TRANSITION_DEBOUNCE_MS = 150;

  constructor(sqliteStore?: SqliteStore) {
    this.wss = new WebSocketServer({ noServer: true });
    // Use shared singleton - same connection as Discord bot
    this.socketClient = SocketClient.getSharedInstance();
    this.apiClient = new ApiClient();
    this.audioPlayer = new AudioPlayer();
    this.sessionStore = new SessionStore(sqliteStore);
    this.debugMode = process.env.DEBUG_AUDIO === '1';
    this.webMode = process.env.WEB_AUDIO === '1';
    if (this.webMode) {
      console.log('[WebSocket] Web audio mode enabled via WEB_AUDIO=1');
    } else if (this.debugMode) {
      console.log('[WebSocket] Debug mode enabled via DEBUG_AUDIO=1');
    }
    this.setupWebSocket();
    this.setupAudioPlayer();
  }

  private log(source: 'go' | 'nodejs', message: string, userId?: string): void {
    if (this.webMode) return;

    const prefix = userId ? `[${userId.slice(0, 8)}]` : '';
    console.log(`[${source === 'go' ? 'Go' : 'Node'}]${prefix} ${message}`);

    // Only broadcast logs to the user's clients if userId is provided
    if (userId) {
      this.broadcastJsonToUser(userId, { type: 'log', source, message });
    }
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      // Authenticate via cookie
      const user = this.authenticateConnection(req);

      if (!user) {
        console.log('[WebSocket] Unauthorized connection attempt');
        ws.close(4401, 'Unauthorized');
        return;
      }

      console.log(`[WebSocket] User ${user.username} (${user.sub}) connected`);

      // Get or create user session (session ID = Discord user ID)
      const session = this.sessionStore.getOrCreate(user.sub, user.username, user.avatar);

      // Track this client
      this.clients.set(ws, user.sub);

      // Setup queue manager event handler for this session
      this.setupQueueManagerForSession(session);

      // Send initial state for this user's session
      ws.send(JSON.stringify({
        type: 'state',
        user: { id: user.sub, username: user.username, avatar: user.avatar },
        debugMode: this.debugMode,
        webMode: this.webMode,
        isPaused: session.isPaused,
        isPlaying: session.currentSessionId !== null,
        session_id: session.currentSessionId ?? undefined,
        playback_secs: this.getPlaybackSeconds(session),
        ...session.queueManager.getState(),
      }));

      ws.on('message', (data) => this.handleBrowserMessage(ws, data, session));

      ws.on('close', async () => {
        console.log(`[WebSocket] User ${user.username} disconnected`);
        this.clients.delete(ws);

        // Auto-pause Go to save resources when browser disconnects
        if (session.currentSessionId && !session.isPaused) {
          try {
            await this.apiClient.pause(session.currentSessionId);
            session.isPaused = true;
            console.log(`[WebSocket] Auto-paused session ${session.currentSessionId} due to disconnect`);
          } catch (err) {
            console.error(`[WebSocket] Failed to auto-pause:`, err);
          }
        }
        // Don't cleanup session - user might reconnect
      });

      ws.on('error', (err) => {
        this.log('nodejs', `WebSocket error: ${err.message}`, user.sub);
      });
    });
  }

  private authenticateConnection(req: IncomingMessage): JwtPayload | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = parseCookie(cookieHeader);
    const token = cookies.auth;
    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    // Check whitelist
    if (config.allowedDiscordIds.length > 0 && !config.allowedDiscordIds.includes(payload.sub)) {
      console.log(`[WebSocket] Access denied for user ${payload.username} (${payload.sub}) - not in whitelist`);
      return null;
    }

    return payload;
  }

  private setupQueueManagerForSession(session: UserSession): void {
    // Remove existing listeners to prevent duplicates
    session.queueManager.removeAllListeners('update');
    session.queueManager.removeAllListeners('persist');

    session.queueManager.on('update', (state: QueueState) => {
      this.broadcastJsonToUser(session.userId, {
        type: 'queueUpdated',
        queue: state.queue,
        currentIndex: state.currentIndex,
        nowPlaying: state.nowPlaying,
      });
    });

    // Persist queue changes to SQLite
    session.queueManager.on('persist', () => {
      this.sessionStore.persist(session.userId);
    });
  }

  private setupAudioPlayer(): void {
    this.audioPlayer.on('stopped', () => {
      // Don't broadcast - we handle state manually
    });

    this.audioPlayer.on('error', (err: Error) => {
      console.log(`[Node] Audio player error: ${err.message}`);
    });
  }

  async connect(): Promise<void> {
    // First check if Go API is healthy
    try {
      const health = await this.apiClient.health();
      console.log(`[Node] Go API health: ${health.status}`);
    } catch (err) {
      throw new Error('Go API not available. Start Go server first.');
    }

    // Then connect socket for audio
    try {
      await this.socketClient.connect();
      console.log('[Node] Connected to Go socket (audio)');

      this.socketClient.on('event', (event: Event) => {
        this.handleGoEvent(event);
      });

      this.socketClient.on('audio', ({ sessionId, data }: { sessionId: string; data: Buffer }) => {
        this.handleAudioData(sessionId, data);
      });

      this.socketClient.on('close', () => {
        console.log('[Go] Socket connection closed');
        // Reset all sessions
        for (const session of this.sessionStore.getAll()) {
          this.resetPlaybackState(session);
          this.broadcastJsonToUser(session.userId, {
            type: 'error',
            session_id: '',
            message: 'Server disconnected'
          });
        }
      });

    } catch (err) {
      console.log(`[Node] Failed to connect to Go socket: ${err}`);
      throw err;
    }
  }

  private handleAudioData(sessionId: string, data: Buffer): void {
    // Find session by session ID directly (no loop needed)
    const session = this.sessionStore.findBySessionId(sessionId);
    if (!session) {
      // Unknown session - might be stale, drop packet silently
      return;
    }

    if (session.isPaused) return;

    session.bytesReceived += data.length;

    // Route audio based on mode
    if (this.webMode && session.isStreamReady) {
      this.broadcastBinaryToUser(session.userId, data);
    } else if (this.debugMode && session.isStreamReady) {
      this.audioPlayer.write(data);
    }

    // Update progress every ~100KB (non-web mode)
    if (!this.webMode && session.bytesReceived % 100000 < data.length) {
      const playbackSecs = session.bytesReceived / 192000;
      this.broadcastJsonToUser(session.userId, {
        type: 'progress',
        bytes: session.bytesReceived,
        playback_secs: playbackSecs,
      });
    }
  }

  private resetPlaybackState(session: UserSession): void {
    if (this.debugMode && !this.webMode) {
      this.audioPlayer.stop();
    }
    session.currentSessionId = null;
    session.isPaused = false;
    session.isStreamReady = false;
    session.bytesReceived = 0;
    session.playbackStartAt = null;
    session.playbackOffsetSec = 0;
    if (session.pendingTransitionTimer) {
      clearTimeout(session.pendingTransitionTimer);
      session.pendingTransitionTimer = null;
    }
    session.pendingTransitionRequestId = 0;
  }

  private getPlaybackSeconds(session: UserSession): number {
    if (session.playbackStartAt) {
      return session.playbackOffsetSec + (Date.now() - session.playbackStartAt) / 1000;
    }
    return session.playbackOffsetSec;
  }

  private async abortCurrentPlayback(session: UserSession): Promise<void> {
    if (session.currentSessionId) {
      session.suppressAutoAdvanceFor.add(session.currentSessionId);
      try {
        await this.apiClient.stop(session.currentSessionId);
      } catch (err) {
        this.log('nodejs', `Stop error (ignored): ${err}`, session.userId);
      }
    }
    this.resetPlaybackState(session);
  }

  private scheduleTransition(session: UserSession, requestId: number, action: () => Promise<void>): void {
    if (session.pendingTransitionTimer) {
      clearTimeout(session.pendingTransitionTimer);
    }
    session.pendingTransitionRequestId = requestId;
    session.pendingTransitionTimer = setTimeout(() => {
      session.pendingTransitionTimer = null;
      if (requestId !== session.activePlayRequestId || requestId !== session.pendingTransitionRequestId) {
        return;
      }
      action().catch((err) => {
        this.log('nodejs', `Transition error: ${err}`, session.userId);
      });
    }, WebSocketHandler.TRANSITION_DEBOUNCE_MS);
  }

  private async handlePlayUrl(session: UserSession, url: string, requestId: number): Promise<void> {
    const nowPlaying = session.queueManager.getCurrentTrack();
    if (session.currentSessionId && nowPlaying && this.extractVideoId(nowPlaying.url) === this.extractVideoId(url)) {
      this.log('nodejs', 'Same video already playing, ignoring', session.userId);
      return;
    }

    await this.abortCurrentPlayback(session);

    try {
      // Spotify URL → fetch metadata instantly, add to queue with placeholder URLs
      if (isSpotifyUrl(url)) {
        this.log('nodejs', 'Detected Spotify URL, loading tracks...', session.userId);
        this.broadcastJsonToUser(session.userId, { type: 'status', message: 'Loading Spotify...' });

        const spotifyTracks = await getSpotifyTracks(url);
        if (requestId !== session.activePlayRequestId) return;

        if (spotifyTracks.length === 0) {
          this.broadcastJsonToUser(session.userId, { type: 'error', message: 'Could not load Spotify URL' });
          return;
        }

        // Add all tracks instantly with spotify:search: placeholder URLs
        for (const t of spotifyTracks) {
          const displayTitle = t.artist ? `${t.title} - ${t.artist}` : t.title;
          session.queueManager.addTrack(
            buildSpotifySearchUrl(t.title, t.artist),
            displayTitle,
            Math.round(t.durationMs / 1000),
          );
        }

        this.log('nodejs', `Added ${spotifyTracks.length} Spotify tracks to queue`, session.userId);

        // Start playing first track (will resolve to YouTube in playTrack)
        const startIdx = session.queueManager.getQueue().length - spotifyTracks.length;
        const firstTrack = session.queueManager.startPlaying(startIdx);
        if (firstTrack) {
          this.broadcastJsonToUser(session.userId, { type: 'nowPlaying', nowPlaying: firstTrack });
          await this.playTrack(session, firstTrack.url, requestId, 0, firstTrack.duration);
        }
        return;
      }

      // Check if playlist URL (exclude YouTube Mix/Radio playlists)
      const listMatch = url.match(/[?&]list=([^&]+)/);
      const isPlaylist = (url.includes('list=') || url.includes('/playlist'))
        && listMatch && !listMatch[1].startsWith('RD');

      if (isPlaylist && listMatch) {
        this.log('nodejs', 'Detected playlist, extracting videos...', session.userId);
        this.broadcastJsonToUser(session.userId, { type: 'status', message: 'Loading playlist...' });

        const playlist = await getFastPlaylist(listMatch[1]);
        if (requestId !== session.activePlayRequestId) return;
        if (playlist.error) {
          this.broadcastJsonToUser(session.userId, { type: 'error', message: playlist.error });
          return;
        }

        this.log('nodejs', `Found ${playlist.count} videos in playlist`, session.userId);

        for (const entry of playlist.entries) {
          session.queueManager.addTrack(entry.url, entry.title, entry.duration, entry.thumbnail);
        }

        const firstTrack = session.queueManager.startPlaying(0);
        if (firstTrack) {
          this.broadcastJsonToUser(session.userId, { type: 'nowPlaying', nowPlaying: firstTrack });
          await this.playTrack(session, firstTrack.url, requestId, 0, firstTrack.duration);
        }
      } else {
        // Single video - use fast metadata
        const videoId = this.extractVideoId(url);
        const metadata = await getFastMetadata(url, videoId);
        if (requestId !== session.activePlayRequestId) return;

        const title = metadata?.title || 'Unknown';
        const duration = metadata?.duration || 0;
        const thumbnail = metadata?.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');

        session.queueManager.addTrack(url, title, duration, thumbnail);
        const track = session.queueManager.startPlaying(session.queueManager.getQueue().length - 1);
        if (track) {
          this.broadcastJsonToUser(session.userId, { type: 'nowPlaying', nowPlaying: track });
          await this.playTrack(session, track.url, requestId, 0, track.duration);
        }
      }
    } catch (err) {
      this.log('nodejs', `Failed to process URL: ${err}`, session.userId);
      this.broadcastJsonToUser(session.userId, { type: 'error', message: `Failed to process URL: ${err}` });
    }
  }

  private async handlePlayFromQueue(session: UserSession, index: number, requestId: number): Promise<void> {
    if (session.currentSessionId && index === session.queueManager.getState().currentIndex) {
      this.log('nodejs', 'Same queue index already playing, ignoring', session.userId);
      return;
    }

    await this.abortCurrentPlayback(session);

    const track = session.queueManager.startPlaying(index);
    if (track) {
      this.log('nodejs', `Playing from queue: ${track.title}`, session.userId);
      this.broadcastJsonToUser(session.userId, { type: 'nowPlaying', nowPlaying: track });
      await this.playTrack(session, track.url, requestId, 0, track.duration);
    } else {
      this.log('nodejs', `Invalid queue index: ${index}`, session.userId);
    }
  }

  private async handleSkip(session: UserSession, requestId: number): Promise<void> {
    await this.abortCurrentPlayback(session);

    const nextTrack = session.queueManager.skip();
    if (nextTrack) {
      await this.playTrack(session, nextTrack.url, requestId, 0, nextTrack.duration);
    } else {
      this.log('nodejs', 'No more tracks in queue', session.userId);
      this.broadcastJsonToUser(session.userId, { type: 'queueFinished' });
    }
  }

  private async handlePrevious(session: UserSession, requestId: number): Promise<void> {
    await this.abortCurrentPlayback(session);

    const prevTrack = session.queueManager.previous();
    if (prevTrack) {
      await this.playTrack(session, prevTrack.url, requestId, 0, prevTrack.duration);
    } else {
      this.log('nodejs', 'Already at start of queue', session.userId);
    }
  }

  private async handleResumeFrom(session: UserSession, seconds: number, requestId: number): Promise<void> {
    const track = session.queueManager.getCurrentTrack();
    if (!track) {
      this.log('nodejs', 'No track to resume', session.userId);
      return;
    }

    await this.abortCurrentPlayback(session);

    this.log('nodejs', `Resuming from ${seconds.toFixed(2)}s: ${track.title}`, session.userId);
    this.broadcastJsonToUser(session.userId, { type: 'nowPlaying', nowPlaying: track });
    await this.playTrack(session, track.url, requestId, seconds, track.duration);
  }

  private async playTrack(session: UserSession, url: string, requestId: number, startAtSec: number = 0, duration?: number): Promise<void> {
    // Lazy Spotify resolution: resolve spotify:search: → YouTube URL just before playback
    if (isSpotifySearchUrl(url)) {
      this.log('nodejs', 'Resolving Spotify track to YouTube...', session.userId);
      const resolved = await resolveSpotifySearch(url);
      if (!resolved) {
        this.log('nodejs', 'Failed to resolve Spotify track', session.userId);
        this.broadcastJsonToUser(session.userId, { type: 'error', message: 'Could not find this track on YouTube' });
        return;
      }
      // Update the track in queue so it won't need resolving again
      const currentIndex = session.queueManager.getCurrentIndex();
      if (currentIndex >= 0) {
        session.queueManager.updateTrack(currentIndex, {
          url: resolved.url,
          thumbnail: resolved.thumbnail,
          duration: resolved.duration || duration,
        });
      }
      url = resolved.url;
      duration = resolved.duration || duration;
      this.log('nodejs', `Resolved to: ${resolved.title}`, session.userId);
    }

    if (requestId !== session.activePlayRequestId) return;

    // Use Discord user ID as session ID for Go API
    const sessionId = session.userId;
    session.currentSessionId = sessionId;

    // Reset state for new session
    session.bytesReceived = 0;
    session.isPaused = false;
    session.isStreamReady = false;
    session.playbackStartAt = null;
    session.playbackOffsetSec = startAtSec;

    this.log('nodejs', `Session: ${sessionId.slice(0, 8)}...`, session.userId);
    this.log('nodejs', `Starting playback: ${url}`, session.userId);

    try {
      const format = this.webMode ? 'web' : 'pcm';
      const result = await this.apiClient.play(sessionId, url, format, startAtSec || undefined, duration);

      if (requestId !== session.activePlayRequestId) {
        this.log('nodejs', 'Stale play request, stopping session', session.userId);
        try {
          await this.apiClient.stop(sessionId);
        } catch {
          // Ignore stop errors for stale sessions
        }
        if (session.currentSessionId === sessionId) {
          session.currentSessionId = null;
        }
        return;
      }

      this.log('go', `Play response: ${result.status} (format: ${format})`, session.userId);
      this.broadcastJsonToUser(session.userId, { type: 'session', session_id: sessionId });
    } catch (err) {
      this.log('nodejs', `Play error: ${err}`, session.userId);
      session.currentSessionId = null;
      this.broadcastJsonToUser(session.userId, { type: 'error', session_id: sessionId, message: `${err}` });
    }
  }

  private handleGoEvent(event: Event): void {
    // Find the user session that owns this event
    const session = event.session_id ? this.sessionStore.findBySessionId(event.session_id) : undefined;

    if (!session) {
      // No matching session found - this could be from an old session
      console.log(`[Go] Event ${event.type} for unknown session ${event.session_id?.slice(0, 8) || 'none'}`);
      return;
    }

    const eventSessionShort = event.session_id ? event.session_id.slice(0, 8) : 'none';
    this.log('go', `Event: ${event.type} (session=${eventSessionShort})`, session.userId);

    switch (event.type) {
      case 'ready':
        session.isStreamReady = true;
        if (!session.isPaused) {
          session.playbackStartAt = Date.now();
        }
        if (this.debugMode && !this.webMode && !session.isPaused) {
          this.audioPlayer.start();
        }
        this.broadcastJsonToUser(session.userId, event);
        break;

      case 'finished':
        this.log('go', `Stream finished, total: ${session.bytesReceived} bytes`, session.userId);
        if (this.debugMode && !this.webMode) {
          this.audioPlayer.end();
        }
        session.currentSessionId = null;
        session.isStreamReady = false;
        session.playbackStartAt = null;
        session.playbackOffsetSec = 0;
        this.broadcastJsonToUser(session.userId, { ...event, bytes: session.bytesReceived });

        if (event.session_id && session.suppressAutoAdvanceFor.has(event.session_id)) {
          session.suppressAutoAdvanceFor.delete(event.session_id);
          this.log('nodejs', 'Auto-advance suppressed for stopped session', session.userId);
          break;
        }

        // Auto-advance to next track
        const nextTrack = session.queueManager.currentFinished();
        if (nextTrack) {
          this.log('nodejs', `Auto-advancing to next track: ${nextTrack.title}`, session.userId);
          const requestId = ++session.playRequestId;
          session.activePlayRequestId = requestId;
          this.playTrack(session, nextTrack.url, requestId, 0, nextTrack.duration);
        } else {
          this.log('nodejs', 'Queue finished', session.userId);
          this.broadcastJsonToUser(session.userId, { type: 'queueFinished' });
        }
        break;

      case 'error':
        this.log('go', `Error: ${event.message}`, session.userId);
        this.resetPlaybackState(session);
        this.broadcastJsonToUser(session.userId, event);
        break;

      default:
        this.broadcastJsonToUser(session.userId, event);
    }
  }

  private async handleBrowserMessage(ws: WebSocket, data: RawData, session: UserSession): Promise<void> {
    try {
      const message = JSON.parse(data.toString());
      this.log('nodejs', `Browser action: ${message.action || message.type}`, session.userId);

      if (message.action === 'play' && message.url) {
        const requestId = ++session.playRequestId;
        session.activePlayRequestId = requestId;
        const url = message.url.trim();
        this.scheduleTransition(session, requestId, () => this.handlePlayUrl(session, url, requestId));

      } else if (message.action === 'addToQueue' && message.url) {
        this.log('nodejs', `Adding to queue: ${message.url}`, session.userId);
        try {
          if (isSpotifyUrl(message.url)) {
            this.broadcastJsonToUser(session.userId, { type: 'status', message: 'Loading Spotify...' });
            const spotifyTracks = await getSpotifyTracks(message.url);
            if (spotifyTracks.length === 0) {
              this.broadcastJsonToUser(session.userId, { type: 'error', message: 'Could not load Spotify URL' });
              return;
            }
            for (const t of spotifyTracks) {
              const displayTitle = t.artist ? `${t.title} - ${t.artist}` : t.title;
              session.queueManager.addTrack(
                buildSpotifySearchUrl(t.title, t.artist),
                displayTitle,
                Math.round(t.durationMs / 1000),
              );
            }
            this.log('nodejs', `Added ${spotifyTracks.length} Spotify track(s) to queue`, session.userId);
          } else {
            const videoId = this.extractVideoId(message.url);
            const metadata = await getFastMetadata(message.url, videoId);
            const title = metadata?.title || 'Unknown';
            const duration = metadata?.duration || 0;
            const thumbnail = metadata?.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');

            session.queueManager.addTrack(message.url, title, duration, thumbnail);
            this.log('nodejs', `Added to queue: ${title}`, session.userId);
          }

          if (!session.currentSessionId) {
            const track = session.queueManager.startPlaying(0);
            if (track) {
              const requestId = ++session.playRequestId;
              session.activePlayRequestId = requestId;
              await this.playTrack(session, track.url, requestId, 0, track.duration);
            }
          }
        } catch (err) {
          this.log('nodejs', `Failed to get metadata: ${err}`, session.userId);
          this.broadcastJsonToUser(session.userId, { type: 'error', message: `Failed to get metadata: ${err}` });
        }

      } else if (message.action === 'removeFromQueue' && typeof message.index === 'number') {
        const removed = session.queueManager.removeTrack(message.index);
        if (removed) {
          this.log('nodejs', `Removed track at index ${message.index}`, session.userId);
        }

      } else if (message.action === 'playFromQueue' && typeof message.index === 'number') {
        const requestId = ++session.playRequestId;
        session.activePlayRequestId = requestId;
        this.log('nodejs', `playFromQueue: index=${message.index}`, session.userId);
        this.scheduleTransition(session, requestId, () => this.handlePlayFromQueue(session, message.index, requestId));

      } else if (message.action === 'skip') {
        const requestId = ++session.playRequestId;
        session.activePlayRequestId = requestId;
        this.log('nodejs', 'Skip requested', session.userId);
        this.scheduleTransition(session, requestId, () => this.handleSkip(session, requestId));

      } else if (message.action === 'previous') {
        const requestId = ++session.playRequestId;
        session.activePlayRequestId = requestId;
        this.log('nodejs', 'Previous requested', session.userId);
        this.scheduleTransition(session, requestId, () => this.handlePrevious(session, requestId));

      } else if (message.action === 'clearQueue') {
        this.log('nodejs', 'Clearing queue', session.userId);
        if (session.currentSessionId) {
          try {
            await this.apiClient.stop(session.currentSessionId);
          } catch (err) {
            this.log('nodejs', `Stop error: ${err}`, session.userId);
          }
        }
        this.resetPlaybackState(session);
        session.queueManager.clear();
        this.broadcastJsonToUser(session.userId, { type: 'stopped' });

      } else if (message.action === 'getQueue') {
        ws.send(JSON.stringify({
          type: 'queueUpdated',
          ...session.queueManager.getState(),
        }));

      } else if (message.action === 'stop') {
        if (session.currentSessionId) {
          this.log('go', 'Stop command sent', session.userId);
          try {
            await this.apiClient.stop(session.currentSessionId);
          } catch (err) {
            this.log('nodejs', `Stop error: ${err}`, session.userId);
          }
        }
        this.resetPlaybackState(session);
        this.broadcastJsonToUser(session.userId, { type: 'stopped' });

      } else if (message.action === 'pause') {
        if (session.currentSessionId && !session.isPaused) {
          if (session.playbackStartAt) {
            session.playbackOffsetSec += (Date.now() - session.playbackStartAt) / 1000;
            session.playbackStartAt = null;
          }
          session.isPaused = true;

          if (this.debugMode && !this.webMode) {
            this.audioPlayer.stop();
          }

          this.broadcastJsonToUser(session.userId, { type: 'paused' });
          this.log('nodejs', 'Playback paused', session.userId);

          this.apiClient.pause(session.currentSessionId).catch((err) => {
            this.log('nodejs', `Pause API error: ${err}`, session.userId);
          });
        }

      } else if (message.action === 'resume') {
        if (session.currentSessionId && session.isPaused) {
          session.playbackStartAt = Date.now();
          const sessionId = session.currentSessionId;

          this.apiClient.resume(sessionId).then(() => {
            this.log('nodejs', 'Playback resumed', session.userId);
          }).catch((err) => {
            this.log('nodejs', `Resume API error: ${err}`, session.userId);
          });

          session.isPaused = false;
          if (this.debugMode && !this.webMode && session.isStreamReady) {
            this.audioPlayer.start();
          }

          this.broadcastJsonToUser(session.userId, { type: 'resumed' });
        }

      } else if (message.action === 'resumeFrom' && typeof message.seconds === 'number') {
        const requestId = ++session.playRequestId;
        session.activePlayRequestId = requestId;
        const seconds = Math.max(0, message.seconds);
        this.log('nodejs', `Resume from ${seconds.toFixed(2)}s requested`, session.userId);
        this.scheduleTransition(session, requestId, () => this.handleResumeFrom(session, seconds, requestId));

      } else if (message.action === 'resetSession') {
        this.log('nodejs', 'Reset session requested', session.userId);
        // Stop current playback if any
        if (session.currentSessionId) {
          try {
            await this.apiClient.stop(session.currentSessionId);
          } catch (err) {
            this.log('nodejs', `Stop error: ${err}`, session.userId);
          }
        }
        // Reset all state
        this.resetPlaybackState(session);
        // Reset session in store (clears queue and deletes from DB)
        this.sessionStore.resetSession(session.userId);
        // Notify client
        this.broadcastJsonToUser(session.userId, { type: 'sessionReset' });
      }
    } catch (err) {
      this.log('nodejs', `Error handling message: ${err}`, session.userId);
    }
  }

  private broadcastJsonToUser(userId: string, data: object): void {
    const json = JSON.stringify(data);
    for (const [ws, uid] of this.clients) {
      if (uid === userId && ws.readyState === 1) {
        ws.send(json);
      }
    }
  }

  private broadcastBinaryToUser(userId: string, data: Buffer): void {
    for (const [ws, uid] of this.clients) {
      if (uid === userId && ws.readyState === 1) {
        ws.send(data, { binary: true });
      }
    }
  }

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

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  isConnected(): boolean {
    return this.socketClient.isConnected();
  }
}
