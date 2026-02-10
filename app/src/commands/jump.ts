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
import { isSpotifySearchUrl, resolveSpotifySearch } from '../spotify-resolver';

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
  if (session.transitionOwner === 'user') {
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

  // Lock transition + suppress auto-advance BEFORE queue mutation
  session.transitionOwner = 'user';
  session.suppressAutoAdvanceFor.add(guildId);

  const track = session.queueManager.startPlaying(targetIndex);

  if (!track) {
    session.transitionOwner = 'none';
    session.suppressAutoAdvanceFor.delete(guildId);
    await interaction.reply({
      content: 'Failed to jump to that track.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show embed immediately (fast response to user)
  const embed = new EmbedBuilder()
    .setColor(0x57F287) // Green
    .setTitle('Now Playing')
    .setDescription(track.title)
    .setThumbnail(track.thumbnail?.startsWith('http') ? track.thumbnail : null)
    .addFields(
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
      { name: 'Position', value: `#${position} of ${queue.length}`, inline: true }
    );

  await interaction.reply({ embeds: [embed] });

  // Start playback in background (don't block UI)
  startJumpTrack(guildId, session, track).catch((error) => {
    console.error('[Jump] Background playback error:', error);
  });
}

// Helper: Start jumped track playback in background
async function startJumpTrack(
  guildId: string,
  session: ReturnType<typeof discordSessions.get>,
  track: NonNullable<ReturnType<typeof discordSessions.get>>['currentTrack']
): Promise<void> {
  if (!session || !track) return;

  try {
    // Stop current playback
    voiceManager.stop(guildId);
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    // Lazy Spotify resolution
    let resolvedTrack = track;
    if (isSpotifySearchUrl(resolvedTrack.url)) {
      console.log(`[Jump] Resolving Spotify track: ${resolvedTrack.title}`);
      const resolved = await resolveSpotifySearch(resolvedTrack.url, resolvedTrack.duration);
      if (!resolved) {
        console.log(`[Jump] Failed to resolve Spotify track: ${resolvedTrack.title}, skipping...`);
        // Auto-advance to next track
        const skipTrack = session.queueManager.skip();
        if (skipTrack) {
          await startJumpTrack(guildId, session, skipTrack);
        }
        return;
      }
      const idx = session.queueManager.getCurrentIndex();
      if (idx >= 0) {
        session.queueManager.updateTrack(idx, { url: resolved.url, thumbnail: resolved.thumbnail, duration: resolved.duration || resolvedTrack.duration });
      }
      resolvedTrack = { ...resolvedTrack, url: resolved.url, thumbnail: resolved.thumbnail, duration: resolved.duration || resolvedTrack.duration };
      console.log(`[Jump] Resolved to: ${resolved.url}`);
    }

    // Start target track
    session.currentTrack = resolvedTrack;
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

    await apiClient.play(guildId, resolvedTrack.url, 'opus', undefined, resolvedTrack.duration);
    await readyPromise;

    // Clear suppress flag
    session.suppressAutoAdvanceFor.delete(guildId);

    const audioStream = socketClient.createAudioStreamForSession(guildId);
    voiceManager.playStream(guildId, audioStream);

    // Track playback start time
    session.playbackStartAt = Date.now();
    session.seekOffset = 0;
  } catch (error) {
    console.error('[Jump] Error starting track:', error);
    session.suppressAutoAdvanceFor.delete(guildId);
  } finally {
    session.transitionOwner = 'none';
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
