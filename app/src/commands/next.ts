// /next command - skip to the next track in queue

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
  .setName('next')
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

  // Prevent concurrent transitions (rapid double-skip)
  if (session.isTransitioning) {
    await interaction.reply({
      content: 'A track change is already in progress, please wait.',
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

  // Lock transition BEFORE any async operation (prevents race with concurrent commands)
  session.isTransitioning = true;

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
      .setColor(0x9B59B6)
      .setTitle('Now Playing')
      .setDescription(nextTrack.title)
      .setThumbnail(nextTrack.thumbnail || null)
      .addFields({
        name: 'Duration',
        value: formatDuration(nextTrack.duration),
        inline: true,
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Next] Error:', error);
    await interaction.editReply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  } finally {
    session.isTransitioning = false;
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
