// /stop command - stops playback and disconnects from voice channel

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';

const apiClient = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop playback and disconnect from voice channel');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!voiceManager.isConnected(guildId)) {
    await interaction.reply({
      content: 'Not currently playing anything.',
      ephemeral: true,
    });
    return;
  }

  try {
    await apiClient.stop(guildId);
    voiceManager.leave(guildId);

    await interaction.reply({
      content: 'Stopped playback and disconnected.',
    });
  } catch (error) {
    console.error('[Stop] Error:', error);
    await interaction.reply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
