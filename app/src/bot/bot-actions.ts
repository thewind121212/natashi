// Bot Actions - Core bot command logic extracted for REST API use
// Each function operates on discordSessions + voiceManager directly
// No Discord.js interaction objects - pure input/output

import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import * as YouTubeSearch from 'youtube-search-api';
import { voiceManager } from '../voice/manager';
import { ApiClient } from '../api-client';
import { SocketClient } from '../socket-client';
import { discordSessions, type GuildSession } from '../discord/session-store';
import type { Track } from '../queue-manager';

interface YouTubeSearchItem {
  id: string;
  type: string;
  title: string;
  channelTitle?: string;
  length?: { simpleText: string };
  thumbnail?: { thumbnails?: { url: string }[] };
}

interface FastMetadata {
  title: string;
  duration: number;
  thumbnail: string;
  url: string;
}

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
      const thumbnail = video.thumbnail?.thumbnails?.length
        ? video.thumbnail.thumbnails[video.thumbnail.thumbnails.length - 1].url
        : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return {
        title: video.title || 'Unknown',
        duration: parseDuration(video.length?.simpleText || ''),
        thumbnail,
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

const apiClient = new ApiClient();
const socketClient = SocketClient.getSharedInstance();

// Discord client reference for sending channel messages
let discordClient: Client | null = null;

export function setDiscordClient(client: Client | null): void {
  discordClient = client;
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

// Send "Now Playing" embed to the guild's text channel
async function sendNowPlayingEmbed(session: GuildSession, track: Track): Promise<void> {
  if (!discordClient || !session.textChannelId) return;
  try {
    const channel = await discordClient.channels.fetch(session.textChannelId);
    if (channel && channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(0x57F287) // Green
        .setTitle('Now Playing')
        .setDescription(`**${track.title}**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: 'Duration', value: formatDuration(track.duration), inline: true },
          { name: 'Source', value: 'Web Controller', inline: true },
        );
      await (channel as TextChannel).send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`[BotActions] Failed to send Now Playing embed:`, err);
  }
}

export interface BotActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface ActiveGuild {
  id: string;
  name: string;
  icon: string; // first 2 letters
  memberCount?: number;
}

export interface GuildStateResponse {
  guildId: string;
  guildName: string;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  nowPlaying: Track | null;
  queue: Track[];
  currentIndex: number;
  isPaused: boolean;
  isTransitioning: boolean;
  playbackTime: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// Shared helper: wait for Go 'ready' event
function waitForReady(guildId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socketClient.off('event', handler);
      reject(new Error('Timeout waiting for ready event'));
    }, 30000);

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
}

// Shared helper: stop current → start new track → wait ready → play stream
async function startTrackOnGuild(guildId: string, session: GuildSession, track: Track, startAt?: number): Promise<BotActionResult> {
  session.suppressAutoAdvanceFor.add(guildId);

  try {
    // Stop current player before starting new stream (matches play.ts pattern)
    voiceManager.stop(guildId);
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);

    session.currentTrack = track;
    session.isPaused = false;

    await apiClient.play(guildId, track.url, 'opus', startAt, track.duration);
    await waitForReady(guildId);

    // Clear suppress flag after new track is ready. By now any finished event for
    // the old track has been processed (Go socket is in-order). If the old track
    // already finished naturally before the command was called, Go won't send
    // another finished event, so the flag would leak and block the NEXT track's
    // auto-advance.
    session.suppressAutoAdvanceFor.delete(guildId);

    const audioStream = socketClient.createDirectStreamForSession(guildId);
    const success = voiceManager.playStream(guildId, audioStream);
    if (!success) {
      return { success: false, error: 'Not connected to voice channel' };
    }

    session.playbackStartAt = Date.now();
    session.seekOffset = startAt || 0;

    // Send "Now Playing" embed to Discord channel (skip for seek — same track)
    if (!startAt) {
      sendNowPlayingEmbed(session, track).catch(() => {});
    }

    return { success: true, data: { title: track.title, duration: track.duration } };
  } catch (error) {
    // Clean up suppress flag on error so next natural finish isn't skipped
    session.suppressAutoAdvanceFor.delete(guildId);
    throw error;
  }
}

export async function botPause(guildId: string): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session || !voiceManager.isConnected(guildId) || !session.currentTrack) {
    return { success: false, error: 'Nothing is playing' };
  }
  if (session.isPaused) {
    return { success: false, error: 'Already paused' };
  }

  try {
    voiceManager.pause(guildId);
    // Compute elapsed time before pausing
    if (session.playbackStartAt) {
      session.seekOffset += (Date.now() - session.playbackStartAt) / 1000;
      session.playbackStartAt = null;
    }
    session.isPaused = true;
    await apiClient.pause(guildId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function botResume(guildId: string): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session || !voiceManager.isConnected(guildId) || !session.currentTrack) {
    return { success: false, error: 'Nothing is playing' };
  }
  if (!session.isPaused) {
    return { success: false, error: 'Not paused' };
  }

  try {
    await apiClient.resume(guildId);
    session.isPaused = false;
    session.playbackStartAt = Date.now();
    voiceManager.unpause(guildId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function botSkip(guildId: string): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session || !voiceManager.isConnected(guildId)) {
    return { success: false, error: 'Nothing is playing' };
  }
  if (session.isTransitioning) {
    return { success: false, error: 'A track change is already in progress' };
  }

  const nextTrack = session.queueManager.skip();
  if (!nextTrack) {
    return { success: false, error: 'No more tracks in the queue' };
  }

  session.isTransitioning = true;
  try {
    const result = await startTrackOnGuild(guildId, session, nextTrack);
    return result;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    session.isTransitioning = false;
  }
}

export async function botPrevious(guildId: string): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session || !voiceManager.isConnected(guildId)) {
    return { success: false, error: 'Nothing is playing' };
  }
  if (session.isTransitioning) {
    return { success: false, error: 'A track change is already in progress' };
  }

  const prevTrack = session.queueManager.previous();
  if (!prevTrack) {
    return { success: false, error: 'Already at the beginning of the queue' };
  }

  session.isTransitioning = true;
  try {
    const result = await startTrackOnGuild(guildId, session, prevTrack);
    return result;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    session.isTransitioning = false;
  }
}

export async function botSeek(guildId: string, positionSec: number): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session || !session.currentTrack || !voiceManager.isConnected(guildId)) {
    return { success: false, error: 'Nothing is playing' };
  }
  if (session.isTransitioning) {
    return { success: false, error: 'A track change is already in progress' };
  }
  if (positionSec < 0) {
    return { success: false, error: 'Invalid seek position' };
  }
  if (session.currentTrack.duration > 0 && positionSec >= session.currentTrack.duration) {
    return { success: false, error: 'Seek position beyond track duration' };
  }

  session.isTransitioning = true;
  try {
    const result = await startTrackOnGuild(guildId, session, session.currentTrack, positionSec);
    return result;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    session.isTransitioning = false;
  }
}

export async function botJump(guildId: string, index: number): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session || !voiceManager.isConnected(guildId)) {
    return { success: false, error: 'Nothing is playing' };
  }
  if (session.isTransitioning) {
    return { success: false, error: 'A track change is already in progress' };
  }

  const queue = session.queueManager.getQueue();
  if (index < 0 || index >= queue.length) {
    return { success: false, error: `Invalid index. Queue has ${queue.length} tracks.` };
  }
  if (index === session.queueManager.getCurrentIndex()) {
    return { success: false, error: 'Already playing this track' };
  }

  const track = session.queueManager.startPlaying(index);
  if (!track) {
    return { success: false, error: 'Failed to jump to track' };
  }

  session.isTransitioning = true;
  try {
    const result = await startTrackOnGuild(guildId, session, track);
    return result;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    session.isTransitioning = false;
  }
}

export async function botStop(guildId: string): Promise<BotActionResult> {
  if (!voiceManager.isConnected(guildId)) {
    return { success: false, error: 'Not playing anything' };
  }

  try {
    socketClient.endAudioStreamForSession(guildId);
    await apiClient.stop(guildId);
    discordSessions.reset(guildId);
    voiceManager.leave(guildId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function isPlaylistUrl(url: string): boolean {
  const listMatch = url.match(/[?&]list=([^&]+)/);
  // Exclude YouTube Mix/Radio playlists (list=RD...) — auto-generated, can't extract
  return (url.includes('list=') || url.includes('/playlist'))
    && !(listMatch && listMatch[1].startsWith('RD'));
}

export async function botPlay(guildId: string, url: string): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session) {
    return { success: false, error: 'No active session for this guild. Use a Discord command to start.' };
  }
  if (!voiceManager.isConnected(guildId)) {
    return { success: false, error: 'Bot is not in a voice channel' };
  }

  try {
    const wasPlaying = session.currentTrack !== null;

    if (isPlaylistUrl(url)) {
      // Handle playlist — fetch all entries from Go API
      const playlist = await apiClient.getPlaylist(url);
      if (playlist.error) {
        return { success: false, error: playlist.error };
      }
      if (!playlist.entries || playlist.entries.length === 0) {
        return { success: false, error: 'Playlist is empty' };
      }

      for (const entry of playlist.entries) {
        session.queueManager.addTrack(entry.url, entry.title, entry.duration, entry.thumbnail);
      }

      // If not already playing, start first added track
      if (!wasPlaying) {
        const firstTrack = session.queueManager.startPlaying(0);
        if (firstTrack) {
          const result = await startTrackOnGuild(guildId, session, firstTrack);
          return { ...result, data: { ...result.data, count: playlist.count, playlist: true } };
        }
      }

      return { success: true, data: { count: playlist.count, playlist: true, queued: wasPlaying } };
    }

    // Single track - use fast metadata from youtube-search-api
    const fastMeta = await getFastMetadata(url);
    const title = fastMeta?.title || 'Unknown';
    const duration = fastMeta?.duration || 0;
    const thumbnail = fastMeta?.thumbnail || undefined;

    session.queueManager.addTrack(url, title, duration, thumbnail);

    if (!wasPlaying) {
      const track = session.queueManager.startPlaying(session.queueManager.getQueue().length - 1);
      if (track) {
        const result = await startTrackOnGuild(guildId, session, track);
        return result;
      }
    }

    return { success: true, data: { title, queued: wasPlaying } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function botRemoveFromQueue(guildId: string, index: number): BotActionResult {
  const session = discordSessions.get(guildId);
  if (!session) {
    return { success: false, error: 'No active session' };
  }

  // Prevent removing the currently playing track
  if (index === session.queueManager.getCurrentIndex()) {
    return { success: false, error: 'Cannot remove the currently playing track. Use skip or stop instead.' };
  }

  const removed = session.queueManager.removeTrack(index);
  if (!removed) {
    return { success: false, error: 'Invalid track index' };
  }

  return { success: true };
}

export async function botClearQueue(guildId: string): Promise<BotActionResult> {
  const session = discordSessions.get(guildId);
  if (!session) {
    return { success: false, error: 'No active session' };
  }

  try {
    // Stop playback if something is playing
    if (session.currentTrack) {
      socketClient.endAudioStreamForSession(guildId);
      await apiClient.stop(guildId);
      voiceManager.stop(guildId);
      session.currentTrack = null;
      session.playbackStartAt = null;
      session.seekOffset = 0;
      session.isPaused = false;
    }
    session.queueManager.clear();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export async function botSearch(query: string): Promise<BotActionResult> {
  try {
    const searchResults = await YouTubeSearch.GetListByKeyword(query, false, 6);
    if (!searchResults?.items?.length) {
      return { success: true, data: { results: [], count: 0 } };
    }

    const results = (searchResults.items as YouTubeSearchItem[])
      .filter((item) => item.type === 'video')
      .slice(0, 6)
      .map((item) => {
        const thumbnail = item.thumbnail?.thumbnails?.length
          ? item.thumbnail.thumbnails[item.thumbnail.thumbnails.length - 1].url
          : `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
        return {
          id: item.id,
          url: `https://www.youtube.com/watch?v=${item.id}`,
          title: item.title,
          duration: parseDuration(item.length?.simpleText || ''),
          thumbnail,
          channel: item.channelTitle || '',
        };
      });

    return { success: true, data: { results, count: results.length } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function getActiveGuilds(client: Client): ActiveGuild[] {
  const guilds: ActiveGuild[] = [];
  const sessions = discordSessions.getAllSessions();

  for (const [guildId] of sessions) {
    if (!voiceManager.isConnected(guildId)) continue;

    const guild = client.guilds.cache.get(guildId);
    guilds.push({
      id: guildId,
      name: guild?.name || `Guild ${guildId.slice(0, 6)}`,
      icon: guild?.name ? guild.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'XX',
      memberCount: guild?.memberCount,
    });
  }

  return guilds;
}

export function getGuildState(guildId: string, client: Client): GuildStateResponse | null {
  const session = discordSessions.get(guildId);
  if (!session) return null;

  const isConnected = voiceManager.isConnected(guildId);
  if (!isConnected) return null;

  const guild = client.guilds.cache.get(guildId);

  // Get voice channel info
  let voiceChannelId: string | null = null;
  let voiceChannelName: string | null = null;
  const connection = voiceManager.getConnection(guildId);
  if (connection) {
    voiceChannelId = connection.joinConfig.channelId;
    if (voiceChannelId) {
      const channel = client.channels.cache.get(voiceChannelId);
      voiceChannelName = channel && 'name' in channel ? (channel.name as string) : null;
    }
  }

  // Compute playback time
  let playbackTime = session.seekOffset;
  if (session.playbackStartAt && !session.isPaused) {
    playbackTime += (Date.now() - session.playbackStartAt) / 1000;
  }

  return {
    guildId,
    guildName: guild?.name || `Guild ${guildId.slice(0, 6)}`,
    voiceChannelId,
    voiceChannelName,
    nowPlaying: session.currentTrack,
    queue: session.queueManager.getQueue(),
    currentIndex: session.queueManager.getCurrentIndex(),
    isPaused: session.isPaused,
    isTransitioning: session.isTransitioning,
    playbackTime,
    hasNext: session.queueManager.hasNext(),
    hasPrevious: session.queueManager.hasPrevious(),
  };
}
