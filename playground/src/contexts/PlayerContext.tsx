import { createContext, useContext, type ReactNode } from 'react';
import { useWebSocket, type UseWebSocketReturn } from '@/hooks/useWebSocket';

const PlayerContext = createContext<UseWebSocketReturn | null>(null);

interface PlayerProviderProps {
  children: ReactNode;
  onUnauthorized?: () => void;
}

export function PlayerProvider({ children, onUnauthorized }: PlayerProviderProps) {
  const player = useWebSocket({ onUnauthorized });
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlayer(): UseWebSocketReturn {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return ctx;
}
