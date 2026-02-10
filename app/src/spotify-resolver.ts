// Spotify URL resolver - resolves Spotify tracks/playlists/albums to YouTube URLs
// Used by both web playground (websocket.ts) and Discord bot (play.ts)
//
// Strategy: Lazy resolution
// 1. getSpotifyTracks() fetches metadata instantly from Spotify embed page
// 2. Tracks are added to queue with "spotify:search:..." placeholder URLs
// 3. resolveSpotifySearch() resolves a single track to YouTube just before playback

import * as YouTubeSearch from 'youtube-search-api';
import { ApiClient } from './api-client.js';

const apiClient = new ApiClient();

export interface ResolvedTrack {
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
}

export interface SpotifyTrackInfo {
  title: string;
  artist: string;
  durationMs: number;
  thumbnail: string;
}

interface SpotifyEmbedTrack {
  uri: string;
  title: string;
  subtitle: string;
  duration: number;
  isPlayable: boolean;
}

interface SpotifyEmbedEntity {
  type: string;
  name: string;
  title: string;
  uri: string;
  duration?: number;
  isPlayable?: boolean;
  artists?: Array<{ name: string }>;
  trackList?: SpotifyEmbedTrack[];
  visualIdentity?: { image?: Array<{ url: string }> };
}

export const SPOTIFY_SEARCH_PREFIX = 'spotify:search:';

function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export function isSpotifyUrl(url: string): boolean {
  return /^https?:\/\/(open\.)?spotify\.com\/(track|playlist|album|intl-[a-z]+\/)/.test(url);
}

export function isSpotifySearchUrl(url: string): boolean {
  return url.startsWith(SPOTIFY_SEARCH_PREFIX);
}

export function getSpotifyType(url: string): 'track' | 'playlist' | 'album' | null {
  const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?(track|playlist|album)\//);
  return match ? (match[1] as 'track' | 'playlist' | 'album') : null;
}

function getSpotifyEmbedPath(url: string): string | null {
  const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

// Clean a Spotify search query to avoid confusing YouTube search
// Strips feat/ft tags (artist is already separate), deduplicates artist names
function cleanSearchQuery(title: string, artist: string): string {
  // Remove (feat. ...), (ft. ...), [feat. ...], [ft. ...] from title
  const cleanTitle = title.replace(/[\(\[]\s*(?:feat|ft)\.?\s+[^\)\]]*[\)\]]/gi, '').trim();

  // Split artist field into individual names, deduplicate against title
  const titleLower = cleanTitle.toLowerCase();
  const artists = artist
    .split(/,\s*/)
    .map((a) => a.trim())
    .filter((a) => a && !titleLower.includes(a.toLowerCase()));

  // Use first artist only to keep query short
  const mainArtist = artists[0] || artist.split(/,\s*/)[0]?.trim() || '';
  return mainArtist ? `${cleanTitle} ${mainArtist}` : cleanTitle;
}

// Build a placeholder URL for queue storage
export function buildSpotifySearchUrl(title: string, artist: string): string {
  const query = cleanSearchQuery(title, artist);
  return `${SPOTIFY_SEARCH_PREFIX}${query}`;
}

// Scrape embed page __NEXT_DATA__ — works for track, playlist, and album
// Returns entity with full metadata (title, artists, duration, thumbnail)
async function fetchEmbedEntity(spotifyUrl: string): Promise<SpotifyEmbedEntity | null> {
  const embedPath = getSpotifyEmbedPath(spotifyUrl);
  if (!embedPath) return null;

  const response = await fetch(`https://open.spotify.com/embed/${embedPath}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!scriptMatch) return null;

  const json = JSON.parse(scriptMatch[1]);
  return json?.props?.pageProps?.state?.data?.entity || null;
}

// Fetch Spotify track metadata — fast, no YouTube resolution
// Uses embed page __NEXT_DATA__ for all types (track/playlist/album) ~300ms
export async function getSpotifyTracks(spotifyUrl: string): Promise<SpotifyTrackInfo[]> {
  const type = getSpotifyType(spotifyUrl);
  if (!type) return [];

  try {
    const entity = await fetchEmbedEntity(spotifyUrl);
    if (!entity) return [];

    // Single track: entity has name, artists, duration directly
    if (type === 'track') {
      const title = entity.title || entity.name || '';
      if (!title) return [];
      const artist = entity.artists?.map((a) => a.name).join(', ') || '';
      const thumbnail = entity.visualIdentity?.image?.[0]?.url || '';
      return [{ title, artist, durationMs: entity.duration || 0, thumbnail }];
    }

    // Playlist or album: entity has trackList
    const trackList = entity.trackList;
    if (!Array.isArray(trackList)) return [];

    const tracks = trackList
      .filter((t: SpotifyEmbedTrack) => t.isPlayable && t.title)
      .map((t: SpotifyEmbedTrack) => ({
        title: t.title,
        artist: t.subtitle || '',
        durationMs: t.duration || 0,
        thumbnail: '',
        _spotifyId: t.uri?.split(':').pop() || '',
      }));

    // Batch-fetch per-track album art via embed page (parallel)
    const thumbResults = await Promise.allSettled(
      tracks.map((t) =>
        t._spotifyId
          ? fetchEmbedEntity(`https://open.spotify.com/track/${t._spotifyId}`)
              .then((e) => e?.visualIdentity?.image?.[0]?.url || '')
          : Promise.resolve(''),
      ),
    );
    for (let i = 0; i < tracks.length; i++) {
      const r = thumbResults[i];
      tracks[i].thumbnail = r.status === 'fulfilled' ? r.value : '';
      delete (tracks[i] as Record<string, unknown>)._spotifyId;
    }

    return tracks as SpotifyTrackInfo[];
  } catch {
    return [];
  }
}

const RESOLVE_TIMEOUT_MS = 5_000; // 5s timeout for YouTube search

const PENALTY_KEYWORDS = ['cover', 'remix', 'karaoke', 'instrumental', 'reaction', 'tutorial', '8d audio', 'slowed', 'reverb', 'sped up', 'nightcore', 'bass boosted', 'lofi'];

interface ScoredVideo {
  id: string;
  title: string;
  duration: number;
  score: number;
}

function scoreCandidate(
  video: { id: string; type: string; title: string; length?: { simpleText: string } },
  query: string,
  expectedDurationSec?: number,
): ScoredVideo {
  const ytDuration = parseDuration(video.length?.simpleText || '');
  const title = (video.title || '').toLowerCase();
  const queryLower = query.toLowerCase();
  let score = 0;

  // Duration match — strongest signal when available
  if (expectedDurationSec && expectedDurationSec > 0 && ytDuration > 0) {
    const diff = Math.abs(ytDuration - expectedDurationSec);
    if (diff <= 3) score += 50;       // Near exact
    else if (diff <= 10) score += 30;  // Close
    else if (diff <= 30) score += 10;  // Reasonable
    else score -= 20;                  // Likely wrong version
  }

  // Prefer official content
  if (title.includes('official') && title.includes('audio')) score += 15;
  else if (title.includes('official')) score += 10;
  else if (title.includes('audio')) score += 5;

  // Penalize unwanted versions (unless the query itself contains the keyword)
  for (const keyword of PENALTY_KEYWORDS) {
    if (title.includes(keyword) && !queryLower.includes(keyword)) score -= 15;
  }

  // Penalize very long videos (compilations, mixes)
  if (ytDuration > 600 && (!expectedDurationSec || expectedDurationSec < 600)) score -= 25;

  return { id: video.id, title: video.title || query, duration: ytDuration, score };
}

// Search YouTube using the npm library (fast, scrapes YouTube HTML)
async function searchWithLibrary(
  query: string,
  expectedDurationSec?: number,
): Promise<ResolvedTrack | null> {
  const results = await YouTubeSearch.GetListByKeyword(query, false, 10);
  const items = results?.items as
    | Array<{
        id: string;
        type: string;
        title: string;
        length?: { simpleText: string };
      }>
    | undefined;
  const videos = items?.filter((item) => item.type === 'video');
  if (!videos?.length) return null;

  const scored = videos.map((v) => scoreCandidate(v, query, expectedDurationSec));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  console.log(
    `[Spotify] Picked: "${best.title}" (score=${best.score}, duration=${best.duration}s) from ${scored.length} candidates`,
  );

  return {
    url: `https://www.youtube.com/watch?v=${best.id}`,
    title: best.title,
    duration: best.duration,
    thumbnail: `https://i.ytimg.com/vi/${best.id}/hqdefault.jpg`,
  };
}

// Fallback: search via Go API (uses yt-dlp, slower but more reliable)
async function searchWithGoApi(
  query: string,
  expectedDurationSec?: number,
): Promise<ResolvedTrack | null> {
  console.log(`[Spotify] Falling back to Go API search: "${query}"`);
  const response = await apiClient.search(query);
  if (response.error || !response.results?.length) return null;

  // Score results using same logic
  const scored = response.results.map((r) =>
    scoreCandidate(
      { id: r.id, type: 'video', title: r.title, length: r.duration ? { simpleText: formatDuration(r.duration) } : undefined },
      query,
      expectedDurationSec,
    ),
  );
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  console.log(
    `[Spotify] Go API picked: "${best.title}" (score=${best.score}, duration=${best.duration}s) from ${scored.length} candidates`,
  );

  return {
    url: `https://www.youtube.com/watch?v=${best.id}`,
    title: best.title,
    duration: best.duration,
    thumbnail: `https://i.ytimg.com/vi/${best.id}/hqdefault.jpg`,
  };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Resolve a single spotify:search: URL to a YouTube track
// Called just before playback — ~500ms for one YouTube search
// expectedDurationSec: Spotify track duration for better matching
export async function resolveSpotifySearch(searchUrl: string, expectedDurationSec?: number): Promise<ResolvedTrack | null> {
  if (!searchUrl.startsWith(SPOTIFY_SEARCH_PREFIX)) return null;
  const query = searchUrl.slice(SPOTIFY_SEARCH_PREFIX.length);
  if (!query) return null;

  console.log(`[Spotify] Resolving: "${query}"${expectedDurationSec ? ` (expected ~${expectedDurationSec}s)` : ''}`);

  try {
    const result = await Promise.race([
      (async () => {
        // Try npm library first (faster)
        try {
          const track = await searchWithLibrary(query, expectedDurationSec);
          if (track) return track;
        } catch (err) {
          console.warn(`[Spotify] youtube-search-api failed, using Go API fallback: ${err}`);
        }
        // Fallback to Go API (yt-dlp search)
        return searchWithGoApi(query, expectedDurationSec);
      })(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Spotify resolve timeout')), RESOLVE_TIMEOUT_MS),
      ),
    ]);
    return result;
  } catch (err) {
    console.error(`[Spotify] Resolve failed: ${err}`);
    return null;
  }
}
