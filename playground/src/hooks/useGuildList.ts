import { useBotWebSocket } from '@/contexts/BotWebSocketContext';

export interface ActiveGuild {
  id: string;
  name: string;
  icon: string;
  memberCount?: number;
}

export function useGuildList() {
  const { guilds, botConnected } = useBotWebSocket();
  return { guilds, botConnected };
}
