// /pause command - pause current playback

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { discordSessions } from '../discord/session-store';

const apiClient = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause the current playback');

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

  if (!session || !voiceManager.isConnected(guildId) || !session.currentTrack) {
    await interaction.reply({
      content: 'Nothing is playing right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.isPaused) {
    await interaction.reply({
      content: 'Playback is already paused. Use `/resume` to continue.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Pause Discord player first (prevents idle state)
    voiceManager.pause(guildId);
    session.isPaused = true;

    // Then pause Go server (stops audio generation)
    await apiClient.pause(guildId);

    await interaction.reply({
      content: `Paused: **${session.currentTrack.title}**`,
    });
  } catch (error) {
    console.error('[Pause] Error:', error);
    await interaction.reply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
