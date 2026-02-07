import { useState, useEffect, useCallback, useRef } from 'react';

export interface ActiveGuild {
  id: string;
  name: string;
  icon: string;
  memberCount?: number;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function useGuildList() {
  const [guilds, setGuilds] = useState<ActiveGuild[]>([]);
  const [botConnected, setBotConnected] = useState(true);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchGuilds = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/bot/guilds`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (data.guilds) {
        setGuilds(data.guilds);
        setBotConnected(true);
      } else if (data.error) {
        setBotConnected(false);
        setGuilds([]);
      }
    } catch {
      if (!mountedRef.current) return;
      setBotConnected(false);
      setGuilds([]);
    }
  }, []);

  useEffect(() => {
    fetchGuilds();
    const interval = setInterval(fetchGuilds, 4000);
    return () => clearInterval(interval);
  }, [fetchGuilds]);

  return { guilds, botConnected };
}
