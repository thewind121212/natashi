// /skip command - skip to the next track in queue

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';
import { discordSessions } from '../discord/session-store';

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Skip to the next track in queue');

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

  if (!session || !voiceManager.isConnected(guildId)) {
    await interaction.reply({
      content: 'Nothing is playing right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nextTrack = session.queueManager.skip();

  if (!nextTrack) {
    await interaction.reply({
      content: 'No more tracks in the queue.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Stop current playback (suppress auto-advance since we already advanced)
    session.suppressAutoAdvanceFor.add(guildId);
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    // Start next track
    session.currentTrack = nextTrack;
    session.isPaused = false;

    const audioStream = socketClient.createDirectStreamForSession(guildId);
    voiceManager.playStream(guildId, audioStream);
    await apiClient.play(guildId, nextTrack.url, 'opus');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Skipped')
      .setDescription(`Now playing: **${nextTrack.title}**`)
      .setThumbnail(nextTrack.thumbnail || null)
      .addFields({
        name: 'Duration',
        value: formatDuration(nextTrack.duration),
        inline: true,
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Skip] Error:', error);
    await interaction.editReply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
