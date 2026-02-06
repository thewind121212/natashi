// /status command - show bot health and connection status

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';
import { discordSessions } from '../discord/session-store';

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show bot health and connection status');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  let goHealth = 'Unknown';
  let goStatus = false;

  try {
    const health = await apiClient.health();
    goHealth = health.status === 'ok' ? 'Healthy' : health.status;
    goStatus = health.status === 'ok';
  } catch {
    goHealth = 'Unreachable';
  }

  const socketStatus = socketClient.isConnected();
  const activeSessions = discordSessions.getActiveCount();

  const embed = new EmbedBuilder()
    .setColor(goStatus && socketStatus ? 0x57F287 : 0xED4245)
    .setTitle('Bot Status')
    .addFields(
      {
        name: 'Go Audio Server',
        value: goStatus ? `✓ ${goHealth}` : `✗ ${goHealth}`,
        inline: true,
      },
      {
        name: 'Audio Socket',
        value: socketStatus ? '✓ Connected' : '✗ Disconnected',
        inline: true,
      },
      {
        name: 'Active Sessions',
        value: `${activeSessions}`,
        inline: true,
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
