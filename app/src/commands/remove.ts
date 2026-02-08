// /remove command - remove a track from the queue by position

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { discordSessions } from '../discord/session-store';

export const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Remove a track from the queue')
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

  if (!session || session.queueManager.isEmpty()) {
    await interaction.reply({
      content: 'The queue is empty.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const position = interaction.options.getInteger('position', true);
  const queue = session.queueManager.getQueue();

  if (position < 1 || position > queue.length) {
    await interaction.reply({
      content: `Invalid position. Queue has ${queue.length} track${queue.length === 1 ? '' : 's'} (1-${queue.length}).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetIndex = position - 1;

  // Prevent removing the currently playing track
  if (targetIndex === session.queueManager.getCurrentIndex()) {
    await interaction.reply({
      content: 'Cannot remove the currently playing track. Use `/skip` or `/stop` instead.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const track = queue[targetIndex];
  const removed = session.queueManager.removeTrack(targetIndex);

  if (!removed) {
    await interaction.reply({
      content: 'Failed to remove the track.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C) // Yellow
    .setTitle('Removed from Queue')
    .setDescription(`**${track.title}**`)
    .addFields(
      { name: 'Was at Position', value: `#${position}`, inline: true },
      { name: 'Queue Size', value: `${session.queueManager.getQueue().length} tracks`, inline: true },
    );

  await interaction.reply({ embeds: [embed] });
}
