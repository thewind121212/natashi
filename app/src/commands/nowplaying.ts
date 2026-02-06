// /nowplaying command - show current track info

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { discordSessions } from '../discord/session-store';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Show information about the current track');

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

  if (!session || !session.currentTrack) {
    await interaction.reply({
      content: 'Nothing is playing right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const track = session.currentTrack;
  const queue = session.queueManager.getQueue();
  const currentIndex = session.queueManager.getCurrentIndex();
  const nextTrack = session.queueManager.getNextTrack();

  const statusText = session.isPaused ? 'Paused' : 'Playing';

  const embed = new EmbedBuilder()
    .setColor(session.isPaused ? 0xFEE75C : 0x57F287)
    .setTitle(statusText)
    .setDescription(`**${track.title}**`)
    .setThumbnail(track.thumbnail || null)
    .addFields(
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
      { name: 'Position', value: `${currentIndex + 1}/${queue.length}`, inline: true }
    );

  if (nextTrack) {
    embed.addFields({
      name: 'Up Next',
      value: nextTrack.title,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
