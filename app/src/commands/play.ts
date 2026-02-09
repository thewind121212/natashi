// /play command - plays YouTube audio in user's voice channel with queue support

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  GuildMember,
  EmbedBuilder,
  MessageFlags,
  TextChannel,
  Client,
} from 'discord.js';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';
import { discordSessions } from '../discord/session-store';
import { Track } from '../queue-manager';
import * as YouTubeSearch from 'youtube-search-api';
import { isSpotifyUrl, isSpotifySearchUrl, getSpotifyTracks, buildSpotifySearchUrl, resolveSpotifySearch } from '../spotify-resolver';

interface YouTubeSearchItem {
  id: string;
  type: string;
  title: string;
  channelTitle?: string;
  length?: { simpleText: string };
}

interface FastMetadata {
  title: string;
  duration: number;
  thumbnail: string;
  url: string;
}

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

// Store Discord client reference for sending messages on auto-advance
let discordClient: Client | null = null;

// Extract video ID from YouTube URL
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Parse duration string like "3:45" or "1:23:45" to seconds
function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

// Extract playlist ID from YouTube URL
function extractPlaylistId(url: string): string | null {
  const match = url.match(/[?&]list=([^&]+)/);
  return match ? match[1] : null;
}

interface PlaylistEntry {
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
}

interface PlaylistResult {
  entries: PlaylistEntry[];
  count: number;
  error?: string;
}

// Get playlist data using youtube-search-api (much faster than yt-dlp)
async function getFastPlaylist(url: string): Promise<PlaylistResult> {
  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return { entries: [], count: 0, error: 'Invalid playlist URL' };
  }

  try {
    // GetPlaylistData returns playlist info with video items
    const data = await YouTubeSearch.GetPlaylistData(playlistId, 200);
    if (!data?.items?.length) {
      return { entries: [], count: 0, error: 'Playlist is empty or not found' };
    }

    const entries: PlaylistEntry[] = [];
    for (const item of data.items) {
      if (item.id) {
        entries.push({
          url: `https://www.youtube.com/watch?v=${item.id}`,
          title: item.title || 'Unknown',
          duration: parseDuration(item.length?.simpleText || ''),
          thumbnail: `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
        });
      }
    }

    return { entries, count: entries.length };
  } catch (error) {
    console.error('[Play] Playlist extraction error:', error);
    return { entries: [], count: 0, error: 'Failed to load playlist' };
  }
}

// Get fast metadata using youtube-search-api (much faster than yt-dlp)
async function getFastMetadata(url: string): Promise<FastMetadata | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  try {
    // Search by video ID to get metadata including duration
    const searchResults = await YouTubeSearch.GetListByKeyword(videoId, false, 5);
    const items = searchResults?.items as YouTubeSearchItem[] | undefined;

    // Find the exact video match
    const video = items?.find((item) => item.type === 'video' && item.id === videoId);

    if (video) {
      return {
        title: video.title || 'Unknown',
        duration: parseDuration(video.length?.simpleText || ''),
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }

    // Fallback: use first video result if exact match not found
    const firstVideo = items?.find((item) => item.type === 'video');
    if (firstVideo) {
      return {
        title: firstVideo.title || 'Unknown',
        duration: parseDuration(firstVideo.length?.simpleText || ''),
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }

    return null;
  } catch {
    // Fallback to basic thumbnail
    return {
      title: 'Loading...',
      duration: 0,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }
}

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

  if (focusedValue.includes('spotify.com')) {
    await interaction.respond([
      { name: `Spotify: ${focusedValue.slice(0, 87)}`, value: focusedValue },
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
// Waits for Go's 'ready' event before starting Discord playback to avoid stream timeout
async function playTrack(guildId: string, track: Track, sendNowPlaying = false): Promise<void> {
  console.log(`[Play] playTrack called with guildId="${guildId}" (len=${guildId.length})`);
  const session = discordSessions.get(guildId);
  if (!session) {
    console.log(`[Play] No session found for guildId="${guildId}"`);
    return;
  }

  // Lazy Spotify resolution: resolve spotify:search: → YouTube URL just before playback
  if (isSpotifySearchUrl(track.url)) {
    console.log(`[Play] Resolving Spotify track: ${track.title}`);
    const resolved = await resolveSpotifySearch(track.url);
    if (!resolved) {
      console.error(`[Play] Failed to resolve Spotify track: ${track.title}`);
      return;
    }
    // Update the track in queue so it won't need resolving again
    const currentIndex = session.queueManager.getCurrentIndex();
    if (currentIndex >= 0) {
      session.queueManager.updateTrack(currentIndex, {
        url: resolved.url,
        thumbnail: resolved.thumbnail,
        duration: resolved.duration || track.duration,
      });
    }
    track = { ...track, url: resolved.url, thumbnail: resolved.thumbnail, duration: resolved.duration || track.duration };
    console.log(`[Play] Resolved to: ${resolved.url}`);
  }

  session.currentTrack = track;
  session.isPaused = false;

  // Stop current player before starting new stream
  voiceManager.stop(guildId);

  // End any existing stream
  socketClient.endAudioStreamForSession(guildId);

  // Start Go playback first, then wait for 'ready' event before creating stream
  // This avoids Discord closing the empty stream while waiting for yt-dlp
  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socketClient.off('event', handler);
      reject(new Error('Timeout waiting for ready event'));
    }, 30000); // 30s timeout for yt-dlp extraction

    const handler = (event: { type: string; session_id: string }) => {
      if (event.session_id === guildId && event.type === 'ready') {
        clearTimeout(timeout);
        socketClient.off('event', handler);
        resolve();
      } else if (event.session_id === guildId && event.type === 'error') {
        clearTimeout(timeout);
        socketClient.off('event', handler);
        reject(new Error('Playback error'));
      }
    };

    socketClient.on('event', handler);
  });

  // Tell Go to start (pass duration to skip yt-dlp metadata call)
  await apiClient.play(guildId, track.url, 'opus', undefined, track.duration);

  try {
    // Wait for Go to be ready (yt-dlp done, FFmpeg started)
    await readyPromise;
    console.log(`[Play] Go is ready, creating stream for Discord`);

    // NOW create stream and start Discord playback
    const audioStream = socketClient.createDirectStreamForSession(guildId);
    const success = voiceManager.playStream(guildId, audioStream);
    if (!success) {
      console.error(`[Play] Failed to start stream for guild ${guildId} - not connected to voice`);
      return;
    }

    // Track playback start time for bot controller progress bar
    session.playbackStartAt = Date.now();
    session.seekOffset = 0;

    console.log(`[Play] Now playing: ${track.title}`);

    // Send "Now Playing" message to channel (for auto-advance)
    if (sendNowPlaying && discordClient && session.textChannelId) {
      try {
        const channel = await discordClient.channels.fetch(session.textChannelId);
        if (channel && channel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setColor(0x57F287) // Green
            .setTitle('Now Playing')
            .setDescription(`**${track.title}**`)
            .setThumbnail(track.thumbnail || null)
            .addFields({
              name: 'Duration',
              value: formatDuration(track.duration),
              inline: true,
            });
          await (channel as TextChannel).send({ embeds: [embed] });
        }
      } catch (err) {
        console.error(`[Play] Failed to send Now Playing message:`, err);
      }
    }
  } catch (err) {
    console.error(`[Play] Error waiting for ready:`, err);
  }
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

      // Gracefully end stream and wait for Discord to consume remaining buffered audio
      // This prevents cutting off the last few seconds of the track
      socketClient.gracefulEndStreamForSession(event.session_id);
      const safeToAdvance = await voiceManager.waitForIdle(event.session_id);

      if (!safeToAdvance) {
        // Player is still playing - don't advance yet, it will finish naturally
        // and trigger another finished event or go idle on its own
        console.log(`[Play] Not safe to advance yet for ${event.session_id.slice(0, 8)}, waiting for natural finish`);
        return;
      }

      // Auto-advance to next track
      const nextTrack = session.queueManager.currentFinished();
      if (nextTrack) {
        console.log(`[Play] Auto-advancing to: ${nextTrack.title}`);
        await playTrack(event.session_id, nextTrack, true); // Send "Now Playing" message
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

    // Store client and channel for auto-advance messages
    discordClient = interaction.client;
    session.textChannelId = interaction.channelId;

    // Handle Spotify URLs → load metadata instantly, resolve to YouTube on play
    if (isSpotifyUrl(query)) {
      const spotifyTracks = await getSpotifyTracks(query);

      if (spotifyTracks.length === 0) {
        await interaction.editReply('Could not load Spotify URL.');
        return;
      }

      // Add all tracks instantly with spotify:search: placeholder URLs
      for (const t of spotifyTracks) {
        const displayTitle = t.artist ? `${t.title} - ${t.artist}` : t.title;
        session.queueManager.addTrack(
          buildSpotifySearchUrl(t.title, t.artist),
          displayTitle,
          Math.round(t.durationMs / 1000),
        );
      }

      if (spotifyTracks.length === 1) {
        const t = spotifyTracks[0];
        const displayTitle = t.artist ? `${t.title} - ${t.artist}` : t.title;

        if (!wasPlaying) {
          const track = session.queueManager.startPlaying(session.queueManager.getQueue().length - 1);
          if (track) {
            const voiceChannel = member.voice.channel;
            voiceManager.join(guildId, voiceChannel.id, voiceChannel.guild.voiceAdapterCreator);

            const embed = new EmbedBuilder()
              .setColor(0x1DB954)
              .setTitle('Now Playing (from Spotify)')
              .setDescription(displayTitle)
              .addFields({
                name: 'Duration',
                value: formatDuration(Math.round(t.durationMs / 1000)),
                inline: true,
              });

            playTrack(guildId, track);
            await interaction.editReply({ content: '', embeds: [embed] });
          }
        } else {
          const queuePos = session.queueManager.getQueue().length;
          const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('Added to Queue (from Spotify)')
            .setDescription(`**${displayTitle}**`)
            .addFields(
              { name: 'Duration', value: formatDuration(Math.round(t.durationMs / 1000)), inline: true },
              { name: 'Position in Queue', value: `#${queuePos}`, inline: true },
            );
          await interaction.editReply({ content: '', embeds: [embed] });
        }
      } else {
        // Playlist/album
        const embed = new EmbedBuilder()
          .setColor(0x1DB954)
          .setTitle('Spotify Playlist Added')
          .setDescription(`Added **${spotifyTracks.length}** tracks to the queue`)
          .addFields({
            name: 'Queue Size',
            value: `${session.queueManager.getQueue().length} tracks`,
            inline: true,
          });

        if (!wasPlaying) {
          const startIdx = session.queueManager.getQueue().length - spotifyTracks.length;
          const firstTrack = session.queueManager.startPlaying(startIdx);
          if (firstTrack) {
            const voiceChannel = member.voice.channel;
            voiceManager.join(guildId, voiceChannel.id, voiceChannel.guild.voiceAdapterCreator);
            playTrack(guildId, firstTrack);
            embed.addFields({
              name: 'Now Playing',
              value: firstTrack.title,
              inline: false,
            });
          }
        }

        await interaction.editReply({ content: '', embeds: [embed] });
      }
      return;
    }

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

    // Check if it's a playlist URL (quick check)
    // Exclude YouTube Mix/Radio playlists (list=RD...) — they are auto-generated
    // and can't be extracted by yt-dlp. Treat them as single videos instead.
    const listMatch = url.match(/[?&]list=([^&]+)/);
    const isPlaylistUrl = (url.includes('list=') || url.includes('/playlist'))
      && !(listMatch && listMatch[1].startsWith('RD'));

    if (isPlaylistUrl) {
      // Handle playlist using fast youtube-search-api (no yt-dlp)
      await interaction.editReply('Loading playlist...');

      const playlist = await getFastPlaylist(url);
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
      // Single track - use fast metadata from youtube-search-api
      const fastMeta = await getFastMetadata(url);
      const title = fastMeta?.title || 'Unknown';
      const duration = fastMeta?.duration || 0;
      const thumbnail = fastMeta?.thumbnail || null;

      session.queueManager.addTrack(url, title, duration, thumbnail || undefined);

      if (!wasPlaying) {
        // Not playing - start this track
        const track = session.queueManager.startPlaying(session.queueManager.getQueue().length - 1);
        if (track) {
          // Join voice channel
          const voiceChannel = member.voice.channel;
          voiceManager.join(guildId, voiceChannel.id, voiceChannel.guild.voiceAdapterCreator);

          // Show embed immediately (fast response)
          const embed = new EmbedBuilder()
            .setColor(0x57F287) // Green
            .setTitle('Now Playing')
            .setDescription(track.title)
            .setThumbnail(track.thumbnail || null)
            .addFields({
              name: 'Duration',
              value: formatDuration(track.duration),
              inline: true,
            });

          // Start playback in background (don't await - let UI respond fast)
          playTrack(guildId, track);

          await interaction.editReply({ embeds: [embed] });
        }
      } else {
        // Already playing - add to queue
        const queuePos = session.queueManager.getQueue().length;

        const embed = new EmbedBuilder()
          .setColor(0xFF69B4) // Pink
          .setTitle('Added to Queue')
          .setDescription(`**${title}**`)
          .setThumbnail(thumbnail)
          .addFields(
            { name: 'Duration', value: formatDuration(duration), inline: true },
            { name: 'Position in Queue', value: `#${queuePos}`, inline: true }
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
