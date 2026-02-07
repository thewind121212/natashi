// /status command - show bot health and connection status

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { ApiClient, HealthResponse } from '../api-client';
import { discordSessions } from '../discord/session-store';
import os from 'os';

const apiClient = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show bot health and connection status');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const client = interaction.client;

  // Fetch Go health data
  let goHealth: HealthResponse | null = null;
  let goReachable = false;
  let goLatency = 0;

  try {
    const goStart = Date.now();
    goHealth = await apiClient.health();
    goLatency = Date.now() - goStart;
    goReachable = goHealth.status === 'ok';
  } catch {
    // unreachable
  }

  const wsPing = client.ws.ping;
  const guildCount = client.guilds.cache.size;
  const activeSessions = discordSessions.getActiveCount();

  const embed = new EmbedBuilder()
    .setColor(goReachable ? 0x57F287 : 0xED4245)
    .setDescription(`API: **${wsPing}ms** \u30FB Go API: **${goReachable ? `${goLatency}ms` : 'Unreachable'}**`);

  // Go Audio Server stats
  if (goHealth && goReachable) {
    embed.addFields({
      name: 'Go Audio Server',
      value: [
        `Status: \u2713 Healthy`,
        `RAM: ${goHealth.ram_mb} MB`,
        `Players: ${goHealth.sessions_playing} playing out of ${goHealth.sessions_active}`,
      ].join('\n'),
    });
  } else {
    embed.addFields({
      name: 'Go Audio Server',
      value: '\u2717 Unreachable',
    });
  }

  // Bot stats
  embed.addFields({
    name: 'Bot Stats',
    value: [
      `Guilds: ${guildCount}`,
      `Active Sessions: ${activeSessions}`,
    ].join('\n'),
  });

  // System stats
  const platform = os.platform();
  const release = os.release();

  embed.addFields({
    name: 'System Stats',
    value: `OS: ${platform} ${release}`,
  });

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
