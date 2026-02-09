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

  // Show embed immediately (fast response to user)
  const embed = new EmbedBuilder()
    .setColor(0x57F287) // Green
    .setTitle('Now Playing')
    .setDescription(nextTrack.title)
    .setThumbnail(nextTrack.thumbnail || null)
    .addFields({
      name: 'Duration',
      value: formatDuration(nextTrack.duration),
      inline: true,
    });

  await interaction.reply({ embeds: [embed] });

  // Start playback in background (don't block UI)
  startNextTrack(guildId, session, nextTrack).catch((error) => {
    console.error('[Next] Background playback error:', error);
  });
}

// Helper: Start next track playback in background
async function startNextTrack(
  guildId: string,
  session: ReturnType<typeof discordSessions.get>,
  nextTrack: NonNullable<ReturnType<typeof discordSessions.get>>['currentTrack']
): Promise<void> {
  if (!session || !nextTrack) return;

  try {
    // Stop current playback (suppress auto-advance since we already advanced)
    session.suppressAutoAdvanceFor.add(guildId);
    voiceManager.stop(guildId);
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    // Start next track
    session.currentTrack = nextTrack;
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

    console.log(`[Next] Calling apiClient.play`);
    await apiClient.play(guildId, nextTrack.url, 'opus', undefined, nextTrack.duration);

    // Wait for Go to be ready
    await readyPromise;
    console.log(`[Next] Go is ready, creating stream for Discord`);

    // Clear suppress flag
    session.suppressAutoAdvanceFor.delete(guildId);

    const audioStream = socketClient.createDirectStreamForSession(guildId);
    voiceManager.playStream(guildId, audioStream);

    // Track playback start time
    session.playbackStartAt = Date.now();
    session.seekOffset = 0;
  } catch (error) {
    console.error('[Next] Error starting track:', error);
    session.suppressAutoAdvanceFor.delete(guildId);
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
