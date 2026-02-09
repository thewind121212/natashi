// /stop command - stops playback, clears queue, and disconnects

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';
import { discordSessions } from '../discord/session-store';

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop playback, clear queue, and disconnect');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Clean up audio stream (safe even if not active)
    socketClient.endAudioStreamForSession(guildId);

    // Try to stop Go session (ignore errors - might not have an active session)
    try {
      await apiClient.stop(guildId);
    } catch {
      // No active Go session, that's fine
    }

    // Clear session state
    discordSessions.reset(guildId);

    // Always leave voice channel
    const wasConnected = voiceManager.isConnected(guildId);
    voiceManager.leave(guildId);

    if (wasConnected) {
      await interaction.reply({
        content: 'Stopped playback and disconnected.',
      });
    } else {
      await interaction.reply({
        content: 'Disconnected.',
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error('[Stop] Error:', error);
    // Still try to leave voice even if something else failed
    voiceManager.leave(guildId);
    await interaction.reply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
