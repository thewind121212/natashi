import { useEffect, useRef, useState, useCallback } from 'react';
import type { LogEntry } from '@/components/LogViewer';

interface WebSocketMessage {
  type: string;
  debugMode?: boolean;
  isPaused?: boolean;
  isPlaying?: boolean;
  session_id?: string;
  message?: string;
  bytes?: number;
  playback_secs?: number;
  source?: 'go' | 'nodejs';
}

interface UseWebSocketReturn {
  isConnected: boolean;
  debugMode: boolean;
  isPaused: boolean;
  status: string;
  statusType: 'normal' | 'error' | 'success';
  isPlaying: boolean;
  logs: LogEntry[];
  play: (url: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  clearLogs: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

const formatTime = (secs: number): string => {
  const mins = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return mins + ':' + (s < 10 ? '0' : '') + s;
};

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const playStartTimeRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const [isConnected, setIsConnected] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState('Ready. Paste a YouTube URL and click Play.');
  const [statusType, setStatusType] = useState<'normal' | 'error' | 'success'>('normal');
  const [isPlaying, setIsPlaying] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

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
        setIsPaused(!!msg.isPaused);
        setIsPlaying(!!msg.isPlaying);
        break;

      case 'session':
        updateStatus('Extracting audio...');
        addLog('nodejs', `Session started: ${msg.session_id}`);
        setIsPlaying(true);
        setIsPaused(false);
        break;

      case 'ready': {
        const readyTime = playStartTimeRef.current ? Date.now() - playStartTimeRef.current : 0;
        updateStatus('▶ Playing (ready in ' + readyTime + 'ms)', 'success');
        setIsPlaying(true);
        addLog('nodejs', `Stream ready (${readyTime}ms)`);
        break;
      }

      case 'progress': {
        const playbackTime = formatTime(msg.playback_secs || 0);
        updateStatus('▶ ' + playbackTime + ' | ' + formatBytes(msg.bytes || 0), 'success');
        break;
      }

      case 'error':
        updateStatus('Error: ' + msg.message, 'error');
        setIsPlaying(false);
        setIsPaused(false);
        playStartTimeRef.current = null;
        addLog('nodejs', `Error: ${msg.message}`);
        break;

      case 'finished': {
        const totalTime = playStartTimeRef.current
          ? ((Date.now() - playStartTimeRef.current) / 1000).toFixed(1)
          : '?';
        updateStatus('✓ Finished in ' + totalTime + 's | Total: ' + formatBytes(msg.bytes || 0));
        setIsPlaying(false);
        setIsPaused(false);
        playStartTimeRef.current = null;
        addLog('nodejs', `Finished (${totalTime}s, ${formatBytes(msg.bytes || 0)})`);
        break;
      }

      case 'stopped':
      case 'player_stopped':
        updateStatus('Playback stopped');
        setIsPlaying(false);
        setIsPaused(false);
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
  handleMessageRef.current = handleMessage;
  addLogRef.current = addLog;
  updateStatusRef.current = updateStatus;

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

  const play = useCallback((url: string) => {
    if (!url.trim()) {
      updateStatus('Please enter a YouTube URL', 'error');
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      updateStatus('Not connected to server', 'error');
      return;
    }

    playStartTimeRef.current = Date.now();
    updateStatus('Starting...');
    addLog('nodejs', `Play requested: ${url.trim()}`);
    wsRef.current.send(JSON.stringify({
      action: 'play',
      url: url.trim(),
    }));
  }, [updateStatus, addLog]);

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

  return {
    isConnected,
    debugMode,
    isPaused,
    status,
    statusType,
    isPlaying,
    logs,
    play,
    stop,
    pause,
    resume,
    clearLogs,
  };
}
