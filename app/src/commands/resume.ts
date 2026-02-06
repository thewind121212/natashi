// /resume command - resume paused playback

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { discordSessions } from '../discord/session-store';

const apiClient = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume paused playback');

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

  if (!session.isPaused) {
    await interaction.reply({
      content: 'Playback is not paused.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Resume Go server first (starts audio generation)
    await apiClient.resume(guildId);
    session.isPaused = false;

    // Then unpause Discord player
    voiceManager.unpause(guildId);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Resumed')
      .setDescription(session.currentTrack.title);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[Resume] Error:', error);
    await interaction.reply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
