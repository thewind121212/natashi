// /help command - show all available commands

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Natashi Commands')
    .setDescription('Here are all the commands you can use:')
    .addFields(
      {
        name: '/play <query or URL>',
        value: 'Play a YouTube video or playlist. Supports search queries and URLs.',
      },
      {
        name: '/stop',
        value: 'Stop playback and disconnect from voice.',
      },
      {
        name: '/pause',
        value: 'Pause the current track.',
      },
      {
        name: '/resume',
        value: 'Resume paused playback.',
      },
      {
        name: '/next',
        value: 'Skip to the next track in queue.',
      },
      {
        name: '/previous',
        value: 'Go back to the previous track.',
      },
      {
        name: '/jump <position>',
        value: 'Jump to a specific position in the queue.',
      },
      {
        name: '/seek <time>',
        value: 'Seek to a time position (e.g. `1:30`, `90`).',
      },
      {
        name: '/remove <position>',
        value: 'Remove a track from the queue by position.',
      },
      {
        name: '/queue',
        value: 'Show the current queue with pagination.',
      },
      {
        name: '/nowplaying',
        value: 'Show info about the currently playing track.',
      },
      {
        name: '/status',
        value: 'Show bot health and connection status.',
      },
      {
        name: '/help',
        value: 'Show this help message.',
      }
    );

  await interaction.reply({ embeds: [embed] });
}
