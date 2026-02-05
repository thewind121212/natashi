// /play command - plays YouTube audio in user's voice channel

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';

const apiClient = new ApiClient();
// Use shared singleton - same connection as WebSocket handler
const socketClient = SocketClient.getSharedInstance();

let socketConnected = false;

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play audio from a YouTube URL')
  .addStringOption((option) =>
    option
      .setName('url')
      .setDescription('YouTube URL to play')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);
  const member = interaction.member as GuildMember;
  const guildId = interaction.guildId;

  if (!member.voice.channel) {
    await interaction.reply({
      content: 'You must be in a voice channel to use this command.',
      ephemeral: true,
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Connect to socket if not connected
    if (!socketConnected) {
      await socketClient.connect();
      socketConnected = true;

      socketClient.on('event', (event) => {
        console.log(`[Play] Socket event:`, event);
        if (event.type === 'finished') {
          voiceManager.stop(event.session_id);
        }
      });

      socketClient.on('close', () => {
        socketConnected = false;
      });
    }

    // Stop current playback if any
    if (voiceManager.isConnected(guildId)) {
      voiceManager.stop(guildId);
      await apiClient.stop(guildId);
    }

    // Join voice channel
    const voiceChannel = member.voice.channel;
    voiceManager.join(guildId, voiceChannel.id, voiceChannel.guild.voiceAdapterCreator);

    // Create per-guild audio stream (demuxed by guildId)
    const audioStream = socketClient.createAudioStreamForSession(guildId);
    voiceManager.playStream(guildId, audioStream);

    // Tell Go to start playback (format: opus for Discord)
    const response = await apiClient.play(guildId, url, 'opus');

    if (response.status === 'playing') {
      await interaction.editReply({
        content: `Now playing: ${url}`,
      });
    } else {
      await interaction.editReply({
        content: `Error: ${response.message || 'Unknown error'}`,
      });
    }
  } catch (error) {
    console.error('[Play] Error:', error);
    await interaction.editReply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
