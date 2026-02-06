// /play command - plays YouTube audio in user's voice channel with queue support

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  GuildMember,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';
import { discordSessions } from '../discord/session-store';
import { Track } from '../queue-manager';
import * as YouTubeSearch from 'youtube-search-api';

interface YouTubeSearchItem {
  id: string;
  type: string;
  title: string;
  channelTitle?: string;
  length?: { simpleText: string };
}

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

let eventHandlersAttached = false;

// Simple cache for autocomplete results (expires after 60s)
const searchCache = new Map<string, { results: { name: string; value: string }[]; timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play audio from YouTube')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Search query or YouTube URL')
      .setRequired(true)
      .setAutocomplete(true)
  );

// Autocomplete handler - shows search results as user types (using fast youtube-search-api)
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedValue = interaction.options.getFocused().trim();

  // Don't search if input is too short
  if (focusedValue.length < 2) {
    await interaction.respond([]);
    return;
  }

  // If it looks like a URL, don't search - just show it as option
  if (focusedValue.includes('youtube.com') || focusedValue.includes('youtu.be')) {
    await interaction.respond([
      { name: `URL: ${focusedValue.slice(0, 90)}`, value: focusedValue },
    ]);
    return;
  }

  const cacheKey = focusedValue.toLowerCase();

  try {
    // Check cache first
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      await interaction.respond(cached.results);
      return;
    }

    // Fast search using youtube-search-api (no yt-dlp, much faster)
    const searchResults = await YouTubeSearch.GetListByKeyword(focusedValue, false, 5);

    if (!searchResults || !searchResults.items || searchResults.items.length === 0) {
      await interaction.respond([]);
      return;
    }

    const options = (searchResults.items as YouTubeSearchItem[])
      .filter((item) => item.type === 'video')
      .slice(0, 5)
      .map((item) => {
        const duration = item.length?.simpleText || '';
        const channel = item.channelTitle ? ` - ${item.channelTitle}` : '';
        let name = `${item.title}${channel}${duration ? ` (${duration})` : ''}`;
        if (name.length > 100) {
          name = name.slice(0, 97) + '...';
        }
        return {
          name,
          value: `https://www.youtube.com/watch?v=${item.id}`,
        };
      });

    // Cache the results
    searchCache.set(cacheKey, { results: options, timestamp: Date.now() });

    // Clean old cache entries periodically
    if (searchCache.size > 50) {
      for (const [key, value] of searchCache) {
        if (Date.now() - value.timestamp > CACHE_TTL) {
          searchCache.delete(key);
        }
      }
    }

    await interaction.respond(options);
  } catch (error) {
    console.error('[Play] Autocomplete error:', error);
    await interaction.respond([]);
  }
}

// Helper: Play a track for a guild
async function playTrack(guildId: string, track: Track): Promise<void> {
  const session = discordSessions.get(guildId);
  if (!session) return;

  session.currentTrack = track;
  session.isPaused = false;

  // Create new audio stream
  const audioStream = socketClient.createDirectStreamForSession(guildId);
  voiceManager.playStream(guildId, audioStream);

  // Start playback
  await apiClient.play(guildId, track.url, 'opus');
  console.log(`[Play] Now playing: ${track.title}`);
}

// Helper: Setup event handlers for auto-advance
function setupEventHandlers(): void {
  if (eventHandlersAttached) return;
  eventHandlersAttached = true;

  socketClient.on('event', async (event) => {
    console.log(`[Play] Socket event:`, event.type, event.session_id?.slice(0, 8));

    if (event.type === 'finished') {
      const session = discordSessions.get(event.session_id);
      if (!session) {
        socketClient.endAudioStreamForSession(event.session_id);
        voiceManager.stop(event.session_id);
        return;
      }

      // Check if auto-advance should be suppressed (skip/previous already handled it)
      if (session.suppressAutoAdvanceFor.has(event.session_id)) {
        session.suppressAutoAdvanceFor.delete(event.session_id);
        console.log(`[Play] Auto-advance suppressed for ${event.session_id.slice(0, 8)}`);
        return;
      }

      // Auto-advance to next track
      const nextTrack = session.queueManager.currentFinished();
      if (nextTrack) {
        console.log(`[Play] Auto-advancing to: ${nextTrack.title}`);
        await playTrack(event.session_id, nextTrack);
      } else {
        // Queue finished
        console.log(`[Play] Queue finished for guild ${event.session_id.slice(0, 8)}`);
        socketClient.endAudioStreamForSession(event.session_id);
        voiceManager.stop(event.session_id);
        session.currentTrack = null;
      }
    }
  });

  socketClient.on('close', () => {
    eventHandlersAttached = false;
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true).trim();
  const member = interaction.member as GuildMember;
  const guildId = interaction.guildId;

  if (!member.voice.channel) {
    await interaction.reply({
      content: 'You must be in a voice channel to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Connect to socket if not connected
    if (!socketClient.isConnected()) {
      await socketClient.connect();
    }

    // Setup event handlers for auto-advance
    setupEventHandlers();

    // Get or create session for this guild
    const session = discordSessions.getOrCreate(guildId);
    const wasPlaying = session.currentTrack !== null;

    // Determine if input is URL or search query
    let url = query;
    if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
      // It's a search query - get first result using fast youtube-search-api
      try {
        const searchResults = await YouTubeSearch.GetListByKeyword(query, false, 1);
        const items = searchResults?.items as YouTubeSearchItem[] | undefined;
        const video = items?.find((item) => item.type === 'video');
        if (!video) {
          await interaction.editReply({
            content: `No results found for: ${query}`,
          });
          return;
        }
        url = `https://www.youtube.com/watch?v=${video.id}`;
      } catch {
        await interaction.editReply({
          content: `Search failed for: ${query}`,
        });
        return;
      }
    }

    // Fetch metadata to check if playlist
    const metadata = await apiClient.getMetadata(url);

    if (metadata.is_playlist) {
      // Handle playlist
      await interaction.editReply('Loading playlist...');

      const playlist = await apiClient.getPlaylist(url);
      if (playlist.error) {
        await interaction.editReply(`Error: ${playlist.error}`);
        return;
      }

      // Add all tracks to queue
      for (const entry of playlist.entries) {
        session.queueManager.addTrack(entry.url, entry.title, entry.duration, entry.thumbnail);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Playlist Added')
        .setDescription(`Added **${playlist.count}** tracks to the queue`)
        .addFields({
          name: 'Queue Size',
          value: `${session.queueManager.getQueue().length} tracks`,
          inline: true,
        });

      // If not already playing, start first track
      if (!wasPlaying) {
        const firstTrack = session.queueManager.startPlaying(0);
        if (firstTrack) {
          // Join voice channel
          const voiceChannel = member.voice.channel;
          voiceManager.join(guildId, voiceChannel.id, voiceChannel.guild.voiceAdapterCreator);

          await playTrack(guildId, firstTrack);
          embed.addFields({
            name: 'Now Playing',
            value: firstTrack.title,
            inline: false,
          });
        }
      }

      await interaction.editReply({ embeds: [embed] });

    } else {
      // Single track
      session.queueManager.addTrack(url, metadata.title, metadata.duration, metadata.thumbnail);

      if (!wasPlaying) {
        // Not playing - start this track
        const track = session.queueManager.startPlaying(session.queueManager.getQueue().length - 1);
        if (track) {
          // Join voice channel
          const voiceChannel = member.voice.channel;
          voiceManager.join(guildId, voiceChannel.id, voiceChannel.guild.voiceAdapterCreator);

          await playTrack(guildId, track);

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Now Playing')
            .setDescription(track.title)
            .setThumbnail(track.thumbnail || null)
            .addFields({
              name: 'Duration',
              value: formatDuration(track.duration),
              inline: true,
            });

          await interaction.editReply({ embeds: [embed] });
        }
      } else {
        // Already playing - add to queue
        const queuePos = session.queueManager.getQueue().length;

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Added to Queue')
          .setDescription(metadata.title)
          .setThumbnail(metadata.thumbnail || null)
          .addFields(
            { name: 'Duration', value: formatDuration(metadata.duration), inline: true },
            { name: 'Position', value: `#${queuePos}`, inline: true }
          );

        await interaction.editReply({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('[Play] Error:', error);
    await interaction.editReply({
      content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
