// /jump command - jump to a specific track in the queue by position

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
  .setName('jump')
  .setDescription('Jump to a specific track in the queue')
  .addIntegerOption((option) =>
    option
      .setName('position')
      .setDescription('Track position in the queue (1, 2, 3...)')
      .setRequired(true)
      .setMinValue(1)
  );

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

  // Prevent concurrent transitions
  if (session.isTransitioning) {
    await interaction.reply({
      content: 'A track change is already in progress, please wait.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const position = interaction.options.getInteger('position', true);
  const queue = session.queueManager.getQueue();

  // Validate position (user provides 1-based, internal is 0-based)
  if (position < 1 || position > queue.length) {
    await interaction.reply({
      content: `Invalid position. Queue has ${queue.length} track${queue.length === 1 ? '' : 's'} (1-${queue.length}).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetIndex = position - 1;

  // Check if already playing this track
  if (targetIndex === session.queueManager.getCurrentIndex()) {
    await interaction.reply({
      content: `Already playing track #${position}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const track = session.queueManager.startPlaying(targetIndex);

  if (!track) {
    await interaction.reply({
      content: 'Failed to jump to that track.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Lock transition BEFORE any async operation
  session.isTransitioning = true;

  await interaction.deferReply();

  try {
    // Stop current playback (suppress auto-advance since we set the index manually)
    session.suppressAutoAdvanceFor.add(guildId);
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    // Start target track
    session.currentTrack = track;
    session.isPaused = false;

    // Start Go playback first, wait for 'ready' event, then create Discord stream
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socketClient.off('event', handler);
        reject(new Error('Timeout waiting for ready event'));
      }, 30000);

      const handler = (event: { type: string; session_id: string }) => {
        if (event.session_id === guildId && event.type === 'ready') {
          clearTimeout(timeout);
          socketClient.off('event', handler);
          resolve();
        } else if (event.session_id === guildId && event.type === 'error') {
          clearTimeout(timeout);
          socketClient.off('event', handler);
          reject(new Error('Playback error'));
        }
      };

      socketClient.on('event', handler);
    });

    await apiClient.play(guildId, track.url, 'opus');
    await readyPromise;

    const audioStream = socketClient.createDirectStreamForSession(guildId);
    const success = voiceManager.playStream(guildId, audioStream);
    if (!success) {
      await interaction.editReply({ content: 'Failed to play - not connected to voice channel' });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57F287) // Green
      .setTitle('Now Playing')
      .setDescription(track.title)
      .setThumbnail(track.thumbnail || null)
      .addFields(
        { name: 'Duration', value: formatDuration(track.duration), inline: true },
        { name: 'Position', value: `#${position} of ${queue.length}`, inline: true }
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Jump] Error:', error);
    await interaction.editReply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  } finally {
    session.isTransitioning = false;
  }
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
