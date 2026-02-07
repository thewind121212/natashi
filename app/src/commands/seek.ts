// /seek command - seek to a specific position in the current track

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

// Parse time position from user input
// Accepts: "90" (seconds), "1:30" (MM:SS), "1:02:30" (HH:MM:SS)
function parseTimePosition(input: string): number | null {
  const trimmed = input.trim();

  // Pure number (seconds)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const value = parseFloat(trimmed);
    return isNaN(value) ? null : value;
  }

  // Time format: MM:SS or HH:MM:SS
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const [mins, secs] = parts.map(Number);
    if (isNaN(mins) || isNaN(secs) || secs >= 60 || mins < 0 || secs < 0) return null;
    return mins * 60 + secs;
  }
  if (parts.length === 3) {
    const [hours, mins, secs] = parts.map(Number);
    if (isNaN(hours) || isNaN(mins) || isNaN(secs) || mins >= 60 || secs >= 60 || hours < 0 || mins < 0 || secs < 0) return null;
    return hours * 3600 + mins * 60 + secs;
  }

  return null;
}

export const data = new SlashCommandBuilder()
  .setName('seek')
  .setDescription('Seek to a specific position in the current track')
  .addStringOption((option) =>
    option
      .setName('position')
      .setDescription('Time position (e.g. 90, 1:30, 1:02:30)')
      .setRequired(true)
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

  if (!session || !session.currentTrack || !voiceManager.isConnected(guildId)) {
    await interaction.reply({
      content: 'Nothing is playing right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.isTransitioning) {
    await interaction.reply({
      content: 'A track change is already in progress, please wait.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const positionInput = interaction.options.getString('position', true);
  const seekSeconds = parseTimePosition(positionInput);

  if (seekSeconds === null || seekSeconds < 0) {
    await interaction.reply({
      content: 'Invalid time format. Use seconds (90) or time format (1:30, 1:02:30).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const track = session.currentTrack;

  if (track.duration > 0 && seekSeconds >= track.duration) {
    await interaction.reply({
      content: `Seek position is beyond the track duration (${formatDuration(track.duration)}).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let suppressAutoAdvance = false;

  try {
    session.isTransitioning = true;
    await interaction.deferReply();

    // Stop current playback (suppress auto-advance since we're re-playing same track)
    session.suppressAutoAdvanceFor.add(guildId);
    suppressAutoAdvance = true;
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    session.isPaused = false;

    // Wait for Go to be ready before creating Discord stream
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

    console.log(`[Seek] Seeking to ${seekSeconds}s in: ${track.title}`);
    await apiClient.play(guildId, track.url, 'opus', seekSeconds);

    await readyPromise;
    console.log(`[Seek] Go is ready, creating stream for Discord`);

    const audioStream = socketClient.createDirectStreamForSession(guildId);
    const success = voiceManager.playStream(guildId, audioStream);
    if (!success) {
      session.suppressAutoAdvanceFor.delete(guildId);
      await interaction.editReply({ content: 'Failed to play - not connected to voice channel' });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2) // Blurple
      .setTitle('Seeked')
      .setDescription(`**${track.title}**`)
      .setThumbnail(track.thumbnail || null)
      .addFields({
        name: 'Position',
        value: track.duration > 0
          ? `${formatDuration(seekSeconds)} / ${formatDuration(track.duration)}`
          : formatDuration(seekSeconds),
        inline: true,
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Seek] Error:', error);
    if (suppressAutoAdvance) {
      session.suppressAutoAdvanceFor.delete(guildId);
    }

    const content = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
      });
    }
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
