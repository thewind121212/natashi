// Shared WebSocket connection for the bot controller page
// Replaces REST polling in useGuildList and useBotApi

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { ActiveGuild } from '@/hooks/useGuildList';
import type { GuildState } from '@/hooks/useBotApi';

type GuildStateCallback = (state: GuildState) => void;

interface BotWebSocketContextValue {
  guilds: ActiveGuild[];
  botConnected: boolean;
  subscribe: (guildId: string, callback: GuildStateCallback) => () => void;
}

const BotWebSocketContext = createContext<BotWebSocketContextValue | undefined>(undefined);

function getBotWsUrl(): string {
  const wsOverride = import.meta.env.VITE_WS_URL as string | undefined;
  if (wsOverride && wsOverride.trim()) return wsOverride.trim() + '/ws/bot';

  const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (apiBase && apiBase.trim()) {
    try {
      const url = new URL(apiBase.trim());
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}/ws/bot`;
    } catch {
      // Fall through
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  return `${protocol}//${host}:3000/ws/bot`;
}

export function BotWebSocketProvider({ children }: { children: ReactNode }) {
  const [guilds, setGuilds] = useState<ActiveGuild[]>([]);
  const [botConnected, setBotConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<GuildStateCallback>>>(new Map());
  // Track active subscriptions for re-subscribe on reconnect
  const activeSubsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(getBotWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setBotConnected(true);
        // Re-subscribe to all previously subscribed guilds
        for (const guildId of activeSubsRef.current) {
          ws.send(JSON.stringify({ action: 'subscribe', guildId }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'guildList') {
            setGuilds(msg.guilds || []);
          } else if (msg.type === 'guildState' && msg.guildId) {
            const callbacks = listenersRef.current.get(msg.guildId);
            if (callbacks) {
              for (const cb of callbacks) cb(msg as GuildState);
            }
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setBotConnected(false);
        wsRef.current = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  const subscribe = useCallback((guildId: string, callback: GuildStateCallback): (() => void) => {
    // Register listener
    if (!listenersRef.current.has(guildId)) {
      listenersRef.current.set(guildId, new Set());
    }
    listenersRef.current.get(guildId)!.add(callback);

    // Track subscription and send subscribe message
    const isNew = !activeSubsRef.current.has(guildId);
    activeSubsRef.current.add(guildId);
    if (isNew && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'subscribe', guildId }));
    }

    // Return unsubscribe function
    return () => {
      const set = listenersRef.current.get(guildId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          listenersRef.current.delete(guildId);
          activeSubsRef.current.delete(guildId);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'unsubscribe', guildId }));
          }
        }
      }
    };
  }, []);

  return (
    <BotWebSocketContext.Provider value={{ guilds, botConnected, subscribe }}>
      {children}
    </BotWebSocketContext.Provider>
  );
}

export function useBotWebSocket() {
  const ctx = useContext(BotWebSocketContext);
  if (!ctx) throw new Error('useBotWebSocket must be used within BotWebSocketProvider');
  return ctx;
}
