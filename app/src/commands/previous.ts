// /previous command - go back to the previous track

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
import { isSpotifySearchUrl, resolveSpotifySearch } from '../spotify-resolver';

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

export const data = new SlashCommandBuilder()
  .setName('previous')
  .setDescription('Go back to the previous track');

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

  // Prevent concurrent transitions (rapid commands)
  if (session.isTransitioning) {
    await interaction.reply({
      content: 'A track change is already in progress, please wait.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prevTrack = session.queueManager.previous();

  if (!prevTrack) {
    await interaction.reply({
      content: 'Already at the beginning of the queue.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Lock transition BEFORE any async operation
  session.isTransitioning = true;

  // Show embed immediately (fast response to user)
  const embed = new EmbedBuilder()
    .setColor(0x57F287) // Green
    .setTitle('Now Playing')
    .setDescription(prevTrack.title)
    .setThumbnail(prevTrack.thumbnail || null)
    .addFields({
      name: 'Duration',
      value: formatDuration(prevTrack.duration),
      inline: true,
    });

  await interaction.reply({ embeds: [embed] });

  // Start playback in background (don't block UI)
  startPrevTrack(guildId, session, prevTrack).catch((error) => {
    console.error('[Previous] Background playback error:', error);
  });
}

// Helper: Start previous track playback in background
async function startPrevTrack(
  guildId: string,
  session: ReturnType<typeof discordSessions.get>,
  prevTrack: NonNullable<ReturnType<typeof discordSessions.get>>['currentTrack']
): Promise<void> {
  if (!session || !prevTrack) return;

  try {
    // Stop current playback (suppress auto-advance since we already moved)
    session.suppressAutoAdvanceFor.add(guildId);
    voiceManager.stop(guildId);
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    // Lazy Spotify resolution
    let track = prevTrack;
    if (isSpotifySearchUrl(track.url)) {
      console.log(`[Previous] Resolving Spotify track: ${track.title}`);
      const resolved = await resolveSpotifySearch(track.url);
      if (!resolved) {
        console.error(`[Previous] Failed to resolve Spotify track: ${track.title}`);
        return;
      }
      const idx = session.queueManager.getCurrentIndex();
      if (idx >= 0) {
        session.queueManager.updateTrack(idx, { url: resolved.url, thumbnail: resolved.thumbnail, duration: resolved.duration || track.duration });
      }
      track = { ...track, url: resolved.url, thumbnail: resolved.thumbnail, duration: resolved.duration || track.duration };
      console.log(`[Previous] Resolved to: ${resolved.url}`);
    }

    // Start previous track
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

    await apiClient.play(guildId, track.url, 'opus', undefined, track.duration);
    await readyPromise;

    // Clear suppress flag
    session.suppressAutoAdvanceFor.delete(guildId);

    const audioStream = socketClient.createDirectStreamForSession(guildId);
    voiceManager.playStream(guildId, audioStream);

    // Track playback start time
    session.playbackStartAt = Date.now();
    session.seekOffset = 0;
  } catch (error) {
    console.error('[Previous] Error starting track:', error);
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
