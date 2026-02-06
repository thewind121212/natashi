// /queue command - display the current queue with pagination buttons

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { discordSessions } from '../discord/session-store';
import { Track } from '../queue-manager';

const TRACKS_PER_PAGE = 10;

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Display the current music queue');

function buildQueueEmbed(
  queue: Track[],
  currentIndex: number,
  page: number
): EmbedBuilder {
  const totalPages = Math.ceil(queue.length / TRACKS_PER_PAGE);
  const startIndex = page * TRACKS_PER_PAGE;
  const endIndex = Math.min(startIndex + TRACKS_PER_PAGE, queue.length);

  const trackLines: string[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const track = queue[i];
    const prefix = i === currentIndex ? '▶' : `${i + 1}.`;
    const duration = formatDuration(track.duration);
    const title =
      track.title.length > 45 ? track.title.slice(0, 42) + '...' : track.title;
    trackLines.push(`${prefix} **${title}** \`${duration}\``);
  }

  const totalSeconds = queue.reduce((sum, t) => sum + t.duration, 0);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Queue')
    .setDescription(trackLines.join('\n'))
    .addFields(
      { name: 'Tracks', value: `${queue.length}`, inline: true },
      { name: 'Total Duration', value: formatDuration(totalSeconds), inline: true }
    )
    .setFooter({
      text: `Page ${page + 1}/${totalPages} • Showing ${startIndex + 1}-${endIndex} of ${queue.length}`,
    });

  return embed;
}

function buildPaginationButtons(
  page: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('queue_prev')
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('queue_next')
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
  return row;
}

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
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
      content: 'The queue is empty. Use `/play` to add tracks.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const queue = session.queueManager.getQueue();
  const currentIndex = session.queueManager.getCurrentIndex();
  const totalPages = Math.ceil(queue.length / TRACKS_PER_PAGE);

  // Start at page containing current track
  let currentPage = Math.floor(currentIndex / TRACKS_PER_PAGE);

  const embed = buildQueueEmbed(queue, currentIndex, currentPage);

  // Only show buttons if more than one page
  if (totalPages <= 1) {
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const row = buildPaginationButtons(currentPage, totalPages);

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  // Create collector for button interactions
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000, // 60 seconds
  });

  collector.on('collect', async (buttonInteraction) => {
    // Re-fetch queue in case it changed
    const freshSession = discordSessions.get(guildId);
    if (!freshSession || freshSession.queueManager.isEmpty()) {
      await buttonInteraction.update({
        content: 'Queue is now empty.',
        embeds: [],
        components: [],
      });
      collector.stop();
      return;
    }

    const freshQueue = freshSession.queueManager.getQueue();
    const freshCurrentIndex = freshSession.queueManager.getCurrentIndex();
    const freshTotalPages = Math.ceil(freshQueue.length / TRACKS_PER_PAGE);

    if (buttonInteraction.customId === 'queue_prev') {
      currentPage = Math.max(0, currentPage - 1);
    } else if (buttonInteraction.customId === 'queue_next') {
      currentPage = Math.min(freshTotalPages - 1, currentPage + 1);
    }

    const newEmbed = buildQueueEmbed(freshQueue, freshCurrentIndex, currentPage);
    const newRow = buildPaginationButtons(currentPage, freshTotalPages);

    await buttonInteraction.update({
      embeds: [newEmbed],
      components: [newRow],
    });
  });

  collector.on('end', async () => {
    // Disable buttons after timeout
    try {
      const freshSession = discordSessions.get(guildId);
      if (freshSession && !freshSession.queueManager.isEmpty()) {
        const freshQueue = freshSession.queueManager.getQueue();
        const freshCurrentIndex = freshSession.queueManager.getCurrentIndex();
        const freshTotalPages = Math.ceil(freshQueue.length / TRACKS_PER_PAGE);

        const finalEmbed = buildQueueEmbed(
          freshQueue,
          freshCurrentIndex,
          currentPage
        );
        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('queue_prev')
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('queue_next')
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );

        await interaction.editReply({
          embeds: [finalEmbed],
          components: freshTotalPages > 1 ? [disabledRow] : [],
        });
      }
    } catch {
      // Ignore errors when editing after timeout (message may be deleted)
    }
  });
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
