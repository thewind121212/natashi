import { useEffect, useRef, useState, useCallback } from 'react';
import type { LogEntry } from '@/components/LogViewer';
import { useAudioPlayer } from './useAudioPlayer';

interface Track {
  url: string;
  title: string;
  duration: number;
  thumbnail?: string;
  addedAt: string;
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
  play: (url: string) => void;
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
}

export type { Track };

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const playStartTimeRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

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

  // Audio player for web mode (Opus -> Web Audio API)
  const audioPlayer = useAudioPlayer({
    onProgress: (seconds) => {
      if (mountedRef.current) {
        setPlaybackTime(seconds);
      }
    },
  });

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
        if (msg.queue) setQueue(msg.queue);
        if (typeof msg.currentIndex === 'number') setCurrentIndex(msg.currentIndex);
        if (msg.nowPlaying !== undefined) setNowPlaying(msg.nowPlaying);
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
        setPlaybackTime(0);
        // Reset audio player for new track (web mode)
        audioPlayerRef.current?.reset();
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
    }
  }, [addLog, updateStatus]);

  // Store handlers in refs to avoid effect re-runs
  const handleMessageRef = useRef(handleMessage);
  const addLogRef = useRef(addLog);
  const updateStatusRef = useRef(updateStatus);
  const audioPlayerRef = useRef(audioPlayer);
  const webModeRef = useRef(webMode);
  handleMessageRef.current = handleMessage;
  addLogRef.current = addLog;
  updateStatusRef.current = updateStatus;
  audioPlayerRef.current = audioPlayer;
  webModeRef.current = webMode;

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

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      ws = new WebSocket(`${protocol}//${host}:3000`);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer'; // Enable binary message handling

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        updateStatusRef.current('Connected to server', 'success');
        addLogRef.current('nodejs', 'WebSocket connected');
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        updateStatusRef.current('Disconnected from server', 'error');

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (mountedRef.current) {
            addLogRef.current('nodejs', 'Reconnecting...');
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
          if (webModeRef.current && audioPlayerRef.current.isInitialized()) {
            audioPlayerRef.current.playChunk(new Uint8Array(event.data));
          }
          return;
        }

        // Handle JSON control messages
        try {
          const msg = JSON.parse(event.data);
          handleMessageRef.current(msg);
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
  }, []);

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
    if (webModeRef.current && !audioPlayer.isInitialized()) {
      try {
        await audioPlayer.init();
        addLog('nodejs', 'Audio player initialized (web mode)');
      } catch (err) {
        updateStatus('Failed to initialize audio player', 'error');
        addLog('nodejs', `Audio init error: ${err}`);
        return;
      }
    }

    playStartTimeRef.current = Date.now();
    setCurrentUrl(url.trim());
    updateStatus('Starting...');
    addLog('nodejs', `Play requested: ${url.trim()}`);
    wsRef.current.send(JSON.stringify({
      action: 'play',
      url: url.trim(),
    }));
  }, [updateStatus, addLog, audioPlayer]);

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
    wsRef.current?.send(JSON.stringify({ action: 'resume' }));
    addLog('nodejs', 'Resume requested');
  }, [addLog]);

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

  const skip = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'skip' }));
    updateStatus('Skipping...');
    addLog('nodejs', 'Skip requested');
  }, [updateStatus, addLog]);

  const previous = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'previous' }));
    updateStatus('Going back...');
    addLog('nodejs', 'Previous requested');
  }, [updateStatus, addLog]);

  const clearQueue = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: 'clearQueue' }));
    updateStatus('Queue cleared');
    addLog('nodejs', 'Queue cleared');
  }, [updateStatus, addLog]);

  const playFromQueue = useCallback((index: number) => {
    wsRef.current?.send(JSON.stringify({ action: 'playFromQueue', index }));
    addLog('nodejs', `Playing track ${index + 1} from queue`);
  }, [addLog]);

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
    play,
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
  };
}
