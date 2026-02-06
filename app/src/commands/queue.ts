// /queue command - display the current queue

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { discordSessions } from '../discord/session-store';

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Display the current music queue');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = discordSessions.get(guildId);

  if (!session || session.queueManager.isEmpty()) {
    await interaction.reply({
      content: 'The queue is empty. Use `/play` to add tracks.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const queue = session.queueManager.getQueue();
  const currentIndex = session.queueManager.getCurrentIndex();
  const maxDisplay = 10;

  // Build track list
  const trackLines: string[] = [];
  const startIndex = Math.max(0, currentIndex - 2);
  const endIndex = Math.min(queue.length, startIndex + maxDisplay);

  for (let i = startIndex; i < endIndex; i++) {
    const track = queue[i];
    const prefix = i === currentIndex ? '▶' : `${i + 1}.`;
    const duration = formatDuration(track.duration);
    const title = track.title.length > 45 ? track.title.slice(0, 42) + '...' : track.title;
    trackLines.push(`${prefix} **${title}** \`${duration}\``);
  }

  // Calculate total duration
  const totalSeconds = queue.reduce((sum, t) => sum + t.duration, 0);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Queue')
    .setDescription(trackLines.join('\n'))
    .addFields(
      { name: 'Tracks', value: `${queue.length}`, inline: true },
      { name: 'Total Duration', value: formatDuration(totalSeconds), inline: true }
    );

  if (queue.length > maxDisplay) {
    embed.setFooter({ text: `Showing ${startIndex + 1}-${endIndex} of ${queue.length} tracks` });
  }

  await interaction.reply({ embeds: [embed] });
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
