// Bot Controller API Hook
// Guild state via WebSocket subscription + REST API calls for actions

import { useState, useEffect, useCallback } from 'react';
import { useBotWebSocket } from '@/contexts/BotWebSocketContext';

export interface Track {
  url: string;
  title: string;
  duration: number;
  thumbnail?: string;
  addedAt: string;
}

export interface GuildState {
  guildId: string;
  guildName: string;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  nowPlaying: Track | null;
  queue: Track[];
  currentIndex: number;
  isPaused: boolean;
  isTransitioning: boolean;
  playbackTime: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

const COOLDOWNS: Record<string, number> = {
  seek: 3000,
  skip: 2000,
  previous: 2000,
  jump: 2000,
  play: 2000,
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

export function useBotApi(guildId: string) {
  const { subscribe } = useBotWebSocket();
  const [guildState, setGuildState] = useState<GuildState | null>(null);
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Subscribe to guild state via WebSocket
  useEffect(() => {
    setIsLoadingState(true);
    setGuildState(null);

    const unsubscribe = subscribe(guildId, (state) => {
      setGuildState(state);
      setIsLoadingState(false);
    });

    return unsubscribe;
  }, [guildId, subscribe]);

  const isCoolingDown = useCallback((action: string): boolean => {
    return (cooldowns[action] || 0) > Date.now();
  }, [cooldowns]);

  const startCooldown = useCallback((action: string) => {
    const ms = COOLDOWNS[action];
    if (!ms) return;
    setCooldowns(prev => ({ ...prev, [action]: Date.now() + ms }));
  }, []);

  // Clear cooldowns periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setCooldowns(prev => {
        const now = Date.now();
        const next = { ...prev };
        let changed = false;
        for (const key of Object.keys(next)) {
          if (next[key] <= now) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Action helpers - REST calls, state comes back via WebSocket push
  const doAction = useCallback(async (
    action: string,
    path: string,
    method: string = 'POST',
    body?: Record<string, unknown>
  ) => {
    if (isCoolingDown(action)) return;
    startCooldown(action);
    setError(null);

    try {
      const data = await apiFetch(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!data.success) {
        setError(data.error || 'Action failed');
      }
      // No manual fetch needed - WebSocket will push updated state
    } catch {
      setError(`Failed to ${action}`);
    }
  }, [isCoolingDown, startCooldown]);

  const pause = useCallback(() => {
    doAction('pause', `/api/bot/guild/${guildId}/pause`);
  }, [guildId, doAction]);

  const resume = useCallback(() => {
    doAction('resume', `/api/bot/guild/${guildId}/resume`);
  }, [guildId, doAction]);

  const skip = useCallback(() => {
    doAction('skip', `/api/bot/guild/${guildId}/skip`);
  }, [guildId, doAction]);

  const previous = useCallback(() => {
    doAction('previous', `/api/bot/guild/${guildId}/previous`);
  }, [guildId, doAction]);

  const seek = useCallback((position: number) => {
    doAction('seek', `/api/bot/guild/${guildId}/seek`, 'POST', { position });
  }, [guildId, doAction]);

  const jump = useCallback((index: number) => {
    doAction('jump', `/api/bot/guild/${guildId}/jump`, 'POST', { index });
  }, [guildId, doAction]);

  const play = useCallback((url: string) => {
    doAction('play', `/api/bot/guild/${guildId}/play`, 'POST', { url });
  }, [guildId, doAction]);

  const stop = useCallback(() => {
    doAction('stop', `/api/bot/guild/${guildId}/stop`);
  }, [guildId, doAction]);

  const removeFromQueue = useCallback((index: number) => {
    doAction('removeFromQueue', `/api/bot/guild/${guildId}/queue/${index}`, 'DELETE');
  }, [guildId, doAction]);

  const clearQueue = useCallback(() => {
    doAction('clearQueue', `/api/bot/guild/${guildId}/queue`, 'DELETE');
  }, [guildId, doAction]);

  return {
    guildState,
    isLoadingState,
    error,
    isCoolingDown,
    pause,
    resume,
    skip,
    previous,
    seek,
    jump,
    play,
    stop,
    removeFromQueue,
    clearQueue,
  };
}
