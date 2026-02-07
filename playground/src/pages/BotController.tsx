import { Bot, Music } from 'lucide-react';
import { useGuildList } from '@/hooks/useGuildList';
import { GuildCard } from '@/components/GuildCard';
import { AppHeader } from '@/components/AppHeader';

export default function BotController() {
  const { guilds, botConnected } = useGuildList();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans flex flex-col">
      <AppHeader />

      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        {!botConnected ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
            <Bot className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Bot not connected</p>
            <p className="text-sm mt-1">Start the bot with task run:bot</p>
          </div>
        ) : guilds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
            <Music className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">No active guilds</p>
            <p className="text-sm mt-1">Use /play in Discord to start</p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-8">
            {guilds.map(guild => (
              <GuildCard key={guild.id} guild={guild} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
