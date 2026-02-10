import { useEffect, useRef, useState, useCallback } from 'react';
import { useAudioPlayer } from './useAudioPlayer';

interface LogEntry {
  timestamp: string;
  source: 'go' | 'nodejs';
  message: string;
}

interface Track {
  url: string;
  title: string;
  duration: number;
  thumbnail?: string;
  addedAt: string;
}

interface SearchResult {
  id: string;
  url: string;
  title: string;
  duration: number;
  thumbnail?: string;
  channel?: string;
}

interface User {
  id: string;
  username: string;
  avatar: string | null;
}

interface WebSocketMessage {
  type: string;
  debugMode?: boolean;
  webMode?: boolean;
  isPaused?: boolean;
  isPlaying?: boolean;
  session_id?: string;
  message?: string;
  bytes?: number;
  playback_secs?: number;
  source?: 'go' | 'nodejs';
  queue?: Track[];
  currentIndex?: number;
  nowPlaying?: Track | null;
  user?: User;
  results?: SearchResult[];
  requestId?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  debugMode: boolean;
  webMode: boolean;
  isPaused: boolean;
  status: string;
  statusType: 'normal' | 'error' | 'success';
  isPlaying: boolean;
  currentUrl: string | null;
  playbackTime: number;
  logs: LogEntry[];
  queue: Track[];
  currentIndex: number;
  nowPlaying: Track | null;
  user: User | null;
  volume: number;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchError: string | null;
  play: (url: string) => void;
  search: (query: string) => void;
  clearSearch: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  clearLogs: () => void;
  addToQueue: (url: string) => void;
  removeFromQueue: (index: number) => void;
  playFromQueue: (index: number) => void;
  skip: () => void;
  previous: () => void;
  clearQueue: () => void;
  setVolume: (value: number) => void;
  resetSession: () => void;
  seek: (seconds: number) => void;
}

export type { Track, SearchResult };

interface UseWebSocketOptions {
  onUnauthorized?: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const onUnauthorizedRef = useRef(options.onUnauthorized);
  onUnauthorizedRef.current = options.onUnauthorized;
  const wsRef = useRef<WebSocket | null>(null);
  const playStartTimeRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lastTickRef = useRef<number | null>(null);
  const playbackTimeRef = useRef(0);
  const lastUiProgressUpdateRef = useRef(0);
  const audioProgressOffsetRef = useRef(0);
  const autoPauseRequestedRef = useRef(false);
  const needsResumeFromRef = useRef(false);
  const resumeFromRequestedRef = useRef<number | null>(null);
  const searchRequestIdRef = useRef(0);

  const [isConnected, setIsConnected] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [webMode, setWebMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [statusType, setStatusType] = useState<'normal' | 'error' | 'success'>('normal');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0); // seconds
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Load volume from localStorage (default 1.0)
  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem('player-volume');
    return saved !== null ? parseFloat(saved) : 1.0;
  });
  const volumeSaveTimerRef = useRef<number | null>(null);
  const volumeRef = useRef(volume);
  const audioStartedRef = useRef(false);

  const getWebSocketUrl = useCallback(() => {
    const wsOverride = import.meta.env.VITE_WS_URL as string | undefined;
    if (wsOverride && wsOverride.trim()) return wsOverride.trim();

    const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (apiBase && apiBase.trim()) {
      try {
        const url = new URL(apiBase.trim());
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${url.host}`;
      } catch {
        // Fall through to default
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    return `${protocol}//${host}:3000`;
  }, []);

  const addLog = useCallback((source: 'go' | 'nodejs', message: string) => {
    if (!mountedRef.current) return;
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogs((prev) => [...prev.slice(-500), { timestamp, source, message }]);
  }, []);

  const updateStatus = useCallback((message: string, type: 'normal' | 'error' | 'success' = 'normal') => {
    if (!mountedRef.current) return;
    setStatus(message);
    setStatusType(type);
  }, []);

  // Audio player for web mode (Opus -> Web Audio API)
  const audioPlayer = useAudioPlayer({
    onProgress: (seconds) => {
      const adjusted = audioProgressOffsetRef.current + seconds;
      playbackTimeRef.current = adjusted;
      if (!mountedRef.current) return;
      const now = performance.now();
      if (now - lastUiProgressUpdateRef.current >= 250) {
        lastUiProgressUpdateRef.current = now;
        setPlaybackTime(adjusted);
        lastTickRef.current = Date.now();
      }
    },
  });

  const ensureWebAudioInitialized = useCallback(async () => {
    if (!webModeRef.current.value) return true;
    if (audioPlayer.isInitialized()) return true;
    try {
      audioProgressOffsetRef.current = playbackTimeRef.current;
      await audioPlayer.init();
      // Apply saved volume after init
      audioPlayer.setVolume(volumeRef.current);
      addLog('nodejs', 'Audio player initialized (web mode)');
      return true;
    } catch (err) {
      updateStatus('Failed to initialize audio player', 'error');
      addLog('nodejs', `Audio init error: ${err}`);
      return false;
    }
  }, [audioPlayer, addLog, updateStatus]);

  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    playbackTimeRef.current = playbackTime;
  }, [playbackTime]);

  const handleMessage = useCallback((msg: WebSocketMessage) => {
    if (!mountedRef.current) return;

    // Handle log messages
    if (msg.type === 'log' && msg.source && msg.message) {
      addLog(msg.source, msg.message);
      return;
    }

    switch (msg.type) {
      case 'state':
        // Initial state from server
        setDebugMode(!!msg.debugMode);
        setWebMode(!!msg.webMode);
        setIsPaused(!!msg.isPaused);
        setIsPlaying(!!msg.isPlaying);
        if (msg.user) setUser(msg.user);
        if (typeof msg.playback_secs === 'number') {
          setPlaybackTime(msg.playback_secs);
          lastTickRef.current = Date.now();
        }
        if (msg.queue) setQueue(msg.queue);
        if (typeof msg.currentIndex === 'number') setCurrentIndex(msg.currentIndex);
        if (msg.nowPlaying !== undefined) setNowPlaying(msg.nowPlaying);
        if (msg.webMode && msg.isPlaying && !msg.isPaused && !audioPlayerRef.current.player.isInitialized()) {
          if (!autoPauseRequestedRef.current) {
            autoPauseRequestedRef.current = true;
            needsResumeFromRef.current = true;
            wsRef.current?.send(JSON.stringify({ action: 'pause' }));
          }
        }
        break;

      case 'queueUpdated':
        if (msg.queue) setQueue(msg.queue);
        if (typeof msg.currentIndex === 'number') setCurrentIndex(msg.currentIndex);
        if (msg.nowPlaying !== undefined) setNowPlaying(msg.nowPlaying);
        break;

      case 'nowPlaying':
        if (msg.nowPlaying) setNowPlaying(msg.nowPlaying);
        break;

      case 'queueFinished':
        updateStatus('Queue finished', 'normal');
        setIsPlaying(false);
        addLog('nodejs', 'Queue finished');
        break;

      case 'session':
        updateStatus('Extracting...', 'normal');
        addLog('nodejs', `Session started: ${msg.session_id}`);
        setIsPlaying(true);
        setIsPaused(false);
        if (resumeFromRequestedRef.current !== null) {
          const resumeFrom = resumeFromRequestedRef.current;
          setPlaybackTime(resumeFrom);
          audioProgressOffsetRef.current = resumeFrom;
          lastTickRef.current = Date.now();
          resumeFromRequestedRef.current = null;
        } else {
          setPlaybackTime(0);
          audioProgressOffsetRef.current = 0;
          lastTickRef.current = Date.now();
        }
        audioStartedRef.current = false;
        // Reset audio player for new track (web mode)
        audioPlayerRef.current.player?.reset();
        break;

      case 'ready': {
        const readyTime = playStartTimeRef.current ? Date.now() - playStartTimeRef.current : 0;
        updateStatus('Playing', 'success');
        setIsPlaying(true);
        addLog('nodejs', `Stream ready (${readyTime}ms)`);
        break;
      }

      case 'progress': {
        // Update playback time
        if (typeof msg.playback_secs === 'number') {
          setPlaybackTime(msg.playback_secs);
          lastTickRef.current = Date.now();
        }
        break;
      }

      case 'error':
        updateStatus('Error: ' + msg.message, 'error');
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentUrl(null);
        setNowPlaying(null);
        playStartTimeRef.current = null;
        audioStartedRef.current = false;
        audioProgressOffsetRef.current = 0;
        lastTickRef.current = null;
        addLog('nodejs', `Error: ${msg.message}`);
        break;

      case 'finished': {
        const totalTime = playStartTimeRef.current
          ? ((Date.now() - playStartTimeRef.current) / 1000).toFixed(1)
          : '?';
        updateStatus('Track finished', 'normal');
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentUrl(null);
        setNowPlaying(null);
        playStartTimeRef.current = null;
        audioStartedRef.current = false;
        audioProgressOffsetRef.current = 0;
        lastTickRef.current = null;
        addLog('nodejs', `Finished (${totalTime}s, ${formatBytes(msg.bytes || 0)})`);
        break;
      }

      case 'stopped':
      case 'player_stopped':
        updateStatus('Playback stopped');
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentUrl(null);
        setNowPlaying(null);
        playStartTimeRef.current = null;
        audioStartedRef.current = false;
        audioProgressOffsetRef.current = 0;
        lastTickRef.current = null;
        lastUiProgressUpdateRef.current = 0;
        addLog('nodejs', 'Playback stopped');
        break;

      case 'paused':
        setIsPaused(true);
        updateStatus('⏸ Paused', 'normal');
        break;

      case 'resumed':
        setIsPaused(false);
        updateStatus('▶ Resumed', 'success');
        break;

      case 'searchResults':
        if (msg.requestId && msg.requestId !== searchRequestIdRef.current) return;
        setSearchResults(msg.results || []);
        setIsSearching(false);
        setSearchError(null);
        break;

      case 'searchError':
        if (msg.requestId && msg.requestId !== searchRequestIdRef.current) return;
        setSearchResults([]);
        setIsSearching(false);
        setSearchError(msg.message || 'Search failed');
        break;

      case 'sessionReset':
        // Full reset - clear everything
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentUrl(null);
        setNowPlaying(null);
        setQueue([]);
        setCurrentIndex(-1);
        setPlaybackTime(0);
        playStartTimeRef.current = null;
        audioStartedRef.current = false;
        audioProgressOffsetRef.current = 0;
        lastTickRef.current = null;
        lastUiProgressUpdateRef.current = 0;
        audioPlayerRef.current.player?.reset();
        updateStatus('Session reset', 'normal');
        addLog('nodejs', 'Session reset');
        break;
    }
  }, [addLog, updateStatus]);

  // Store handlers in refs to avoid effect re-runs
  // Using object wrapper to satisfy ESLint immutability rules
  const handleMessageRef = useRef({ fn: handleMessage });
  const addLogRef = useRef({ fn: addLog });
  const updateStatusRef = useRef({ fn: updateStatus });
  const audioPlayerRef = useRef({ player: audioPlayer });
  const webModeRef = useRef({ value: webMode });

  useEffect(() => {
    handleMessageRef.current.fn = handleMessage;
  }, [handleMessage]);

  useEffect(() => {
    addLogRef.current.fn = addLog;
  }, [addLog]);

  useEffect(() => {
    updateStatusRef.current.fn = updateStatus;
  }, [updateStatus]);

  useEffect(() => {
    audioPlayerRef.current.player = audioPlayer;
  }, [audioPlayer]);

  useEffect(() => {
    webModeRef.current.value = webMode;
  }, [webMode]);

  useEffect(() => {
    mountedRef.current = true;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (!mountedRef.current) return;

      // Close existing connection
      if (ws) {
        ws.onclose = null;
        ws.close();
      }

      ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer'; // Enable binary message handling

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        autoPauseRequestedRef.current = false;
        needsResumeFromRef.current = false;
        updateStatusRef.current.fn('Connected to server', 'success');
        addLogRef.current.fn('nodejs', 'WebSocket connected');
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        autoPauseRequestedRef.current = false;
        needsResumeFromRef.current = false;

        // Handle unauthorized - trigger logout
        if (event.code === 4401) {
          updateStatusRef.current.fn('Session expired', 'error');
          onUnauthorizedRef.current?.();
          return;
        }

        updateStatusRef.current.fn('Disconnected from server', 'error');

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (mountedRef.current) {
            addLogRef.current.fn('nodejs', 'Reconnecting...');
            connect();
          }
        }, 2000);
      };

      ws.onerror = () => {
        // Will trigger onclose
      };

      ws.onmessage = (event) => {
        // Handle binary audio data (web mode)
        if (event.data instanceof ArrayBuffer) {
          if (webModeRef.current.value && audioPlayerRef.current.player.isInitialized()) {
            if (!audioStartedRef.current && statusRef.current !== 'Playing') {
              audioStartedRef.current = true;
              updateStatusRef.current.fn('Playing', 'success');
              setIsPlaying(true);
              setIsPaused(false);
            }
            audioPlayerRef.current.player.playChunk(new Uint8Array(event.data));
          }
          return;
        }

        // Handle JSON control messages
        try {
          const msg = JSON.parse(event.data);
          handleMessageRef.current.fn(msg);
        } catch {
          // Ignore
        }
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [getWebSocketUrl]);

  useEffect(() => {
    if (!webMode || !isPlaying || isPaused) {
      lastTickRef.current = null;
      return;
    }
    // Audio player's onProgress handles time updates once initialized
    if (audioPlayerRef.current.player.isInitialized()) return;
    lastTickRef.current = Date.now();
    const timer = window.setInterval(() => {
      if (!mountedRef.current || !lastTickRef.current) return;
      // Stop once audio player takes over progress reporting
      if (audioPlayerRef.current.player.isInitialized()) {
        lastTickRef.current = null;
        clearInterval(timer);
        return;
      }
      const now = Date.now();
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setPlaybackTime((prev) => prev + delta);
    }, 500);
    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webMode, isPlaying, isPaused]);

  const play = useCallback(async (url: string) => {
    if (!url.trim()) {
      updateStatus('Please enter a YouTube URL', 'error');
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      updateStatus('Not connected to server', 'error');
      return;
    }

    // Initialize audio player for web mode (requires user gesture)
    if (!(await ensureWebAudioInitialized())) return;

    playStartTimeRef.current = Date.now();
    setCurrentUrl(url.trim());
    updateStatus('Starting...');
    addLog('nodejs', `Play requested: ${url.trim()}`);
    wsRef.current.send(JSON.stringify({
      action: 'play',
      url: url.trim(),
    }));
  }, [updateStatus, addLog, ensureWebAudioInitialized]);

  const search = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSearchError('Not connected to server');
      setIsSearching(false);
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    setIsSearching(true);
    setSearchError(null);
    wsRef.current.send(JSON.stringify({
      action: 'search',
      query: query.trim(),
      requestId,
    }));
  }, []);

  const clearSearch = useCallback(() => {
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(false);
  }, []);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'stop' }));
    updateStatus('Stopping...');
    addLog('nodejs', 'Stop requested');
  }, [updateStatus, addLog]);

  const pause = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'pause' }));
    addLog('nodejs', 'Pause requested');
  }, [addLog]);

  const resume = useCallback(() => {
    (async () => {
      if (!(await ensureWebAudioInitialized())) return;
      const shouldResumeFrom = needsResumeFromRef.current || (webModeRef.current.value && !audioStartedRef.current);
      if (shouldResumeFrom) {
        needsResumeFromRef.current = false;
        audioPlayerRef.current.player?.reset();
        audioStartedRef.current = false;
        const seconds = playbackTimeRef.current;
        resumeFromRequestedRef.current = seconds;
        setPlaybackTime(seconds);
        audioProgressOffsetRef.current = seconds;
        lastTickRef.current = Date.now();
        wsRef.current?.send(JSON.stringify({ action: 'resumeFrom', seconds }));
      } else {
        wsRef.current?.send(JSON.stringify({ action: 'resume' }));
      }
      addLog('nodejs', 'Resume requested');
    })();
  }, [addLog, ensureWebAudioInitialized]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const addToQueue = useCallback((url: string) => {
    if (!url.trim()) {
      updateStatus('Please enter a YouTube URL', 'error');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      updateStatus('Not connected to server', 'error');
      return;
    }
    updateStatus('Adding to queue...');
    addLog('nodejs', `Adding to queue: ${url.trim()}`);
    wsRef.current.send(JSON.stringify({
      action: 'addToQueue',
      url: url.trim(),
    }));
  }, [updateStatus, addLog]);

  const removeFromQueue = useCallback((index: number) => {
    wsRef.current?.send(JSON.stringify({
      action: 'removeFromQueue',
      index,
    }));
    addLog('nodejs', `Removing track at index ${index}`);
  }, [addLog]);

  const skip = useCallback(async () => {
    if (!(await ensureWebAudioInitialized())) return;
    playStartTimeRef.current = Date.now();
    setPlaybackTime(0);
    audioStartedRef.current = false;
    audioPlayerRef.current.player?.reset();
    wsRef.current?.send(JSON.stringify({ action: 'skip' }));
    updateStatus('Skipping...');
    addLog('nodejs', 'Skip requested');
  }, [updateStatus, addLog, ensureWebAudioInitialized]);

  const previous = useCallback(async () => {
    if (!(await ensureWebAudioInitialized())) return;
    playStartTimeRef.current = Date.now();
    setPlaybackTime(0);
    audioStartedRef.current = false;
    audioPlayerRef.current.player?.reset();
    wsRef.current?.send(JSON.stringify({ action: 'previous' }));
    updateStatus('Going back...');
    addLog('nodejs', 'Previous requested');
  }, [updateStatus, addLog, ensureWebAudioInitialized]);

  const clearQueue = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'clearQueue' }));
    updateStatus('Queue cleared');
    addLog('nodejs', 'Queue cleared');
  }, [updateStatus, addLog]);

  const playFromQueue = useCallback(async (index: number) => {
    if (!(await ensureWebAudioInitialized())) return;
    playStartTimeRef.current = Date.now();
    setPlaybackTime(0);
    audioStartedRef.current = false;
    audioPlayerRef.current.player?.reset();
    wsRef.current?.send(JSON.stringify({ action: 'playFromQueue', index }));
    addLog('nodejs', `Playing track ${index + 1} from queue`);
  }, [addLog, ensureWebAudioInitialized]);

  // Volume control (browser-only, not sent to server)
  // Saves to localStorage with 300ms debounce
  const setVolume = useCallback((value: number) => {
    const clampedValue = Math.max(0, Math.min(1, value));
    setVolumeState(clampedValue);
    volumeRef.current = clampedValue;
    audioPlayerRef.current.player?.setVolume(clampedValue);

    // Debounced save to localStorage
    if (volumeSaveTimerRef.current) {
      clearTimeout(volumeSaveTimerRef.current);
    }
    volumeSaveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem('player-volume', clampedValue.toString());
    }, 300);
  }, []);

  // Reset session completely (clears queue, stops playback, deletes from DB)
  const resetSession = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'resetSession' }));
    addLog('nodejs', 'Reset session requested');
  }, [addLog]);

  // Seek to a specific time position (seconds)
  const seek = useCallback((seconds: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!nowPlaying) return;

    // Clamp to valid range
    const clamped = Math.max(0, Math.min(seconds, nowPlaying.duration));

    // Reset audio player and prepare for new position
    resumeFromRequestedRef.current = clamped;
    setPlaybackTime(clamped);
    audioProgressOffsetRef.current = clamped;
    lastTickRef.current = Date.now();
    audioPlayerRef.current.player?.reset();
    audioStartedRef.current = false;

    wsRef.current.send(JSON.stringify({ action: 'resumeFrom', seconds: clamped }));
    addLog('nodejs', `Seeking to ${Math.floor(clamped / 60)}:${String(Math.floor(clamped % 60)).padStart(2, '0')}`);
  }, [nowPlaying, addLog]);

  return {
    isConnected,
    debugMode,
    webMode,
    isPaused,
    status,
    statusType,
    isPlaying,
    currentUrl,
    playbackTime,
    logs,
    queue,
    currentIndex,
    nowPlaying,
    user,
    volume,
    searchResults,
    isSearching,
    searchError,
    play,
    search,
    clearSearch,
    stop,
    pause,
    resume,
    clearLogs,
    addToQueue,
    removeFromQueue,
    playFromQueue,
    skip,
    previous,
    clearQueue,
    setVolume,
    resetSession,
    seek,
  };
}
