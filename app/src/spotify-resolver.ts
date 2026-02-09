// Spotify URL resolver - resolves Spotify tracks/playlists/albums to YouTube URLs
// Used by both web playground (websocket.ts) and Discord bot (play.ts)
//
// Strategy: Lazy resolution
// 1. getSpotifyTracks() fetches metadata instantly from Spotify embed page
// 2. Tracks are added to queue with "spotify:search:..." placeholder URLs
// 3. resolveSpotifySearch() resolves a single track to YouTube just before playback

import * as YouTubeSearch from 'youtube-search-api';

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

interface SpotifyOEmbed {
  title: string;
  thumbnail_url?: string;
  type: string;
}

interface SpotifyEmbedTrack {
  uri: string;
  title: string;
  subtitle: string;
  duration: number;
  isPlayable: boolean;
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

// Build a placeholder URL for queue storage
export function buildSpotifySearchUrl(title: string, artist: string): string {
  const query = artist ? `${title} ${artist}` : title;
  return `${SPOTIFY_SEARCH_PREFIX}${query}`;
}

// Fetch Spotify track metadata — fast, no YouTube resolution
// Single track: uses oEmbed (~200ms)
// Playlist/album: uses embed page __NEXT_DATA__ (~300ms)
export async function getSpotifyTracks(spotifyUrl: string): Promise<SpotifyTrackInfo[]> {
  const type = getSpotifyType(spotifyUrl);
  if (!type) return [];

  if (type === 'track') {
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
      const response = await fetch(oembedUrl);
      if (!response.ok) return [];
      const data = (await response.json()) as SpotifyOEmbed;
      if (!data?.title) return [];
      // oEmbed title is "Track Name - Artist", thumbnail_url is album art
      return [{ title: data.title, artist: '', durationMs: 0, thumbnail: data.thumbnail_url || '' }];
    } catch {
      return [];
    }
  }

  // Playlist or album: scrape embed page
  const embedPath = getSpotifyEmbedPath(spotifyUrl);
  if (!embedPath) return [];

  try {
    const response = await fetch(`https://open.spotify.com/embed/${embedPath}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];

    const html = await response.text();
    const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!scriptMatch) return [];

    const json = JSON.parse(scriptMatch[1]);
    const entity = json?.props?.pageProps?.state?.data?.entity;
    const trackList = entity?.trackList;
    if (!Array.isArray(trackList)) return [];

    // Extract cover art: visualIdentity has multiple resolutions, pick largest
    const viImages = entity?.visualIdentity?.image as Array<{ url: string; width: number; height: number }> | undefined;
    const coverArtUrl = entity?.coverArt?.sources?.[0]?.url as string | undefined;
    const bestImage = viImages?.reduce((best, img) => (img.width > best.width ? img : best), viImages[0]);
    const thumbnail = bestImage?.url || coverArtUrl || '';

    return trackList
      .filter((t: SpotifyEmbedTrack) => t.isPlayable && t.title)
      .map((t: SpotifyEmbedTrack) => ({
        title: t.title,
        artist: t.subtitle || '',
        durationMs: t.duration || 0,
        thumbnail,
      }));
  } catch {
    return [];
  }
}

const RESOLVE_TIMEOUT_MS = 5_000; // 5s timeout for YouTube search

// Resolve a single spotify:search: URL to a YouTube track
// Called just before playback — ~500ms for one YouTube search, 10s timeout
export async function resolveSpotifySearch(searchUrl: string): Promise<ResolvedTrack | null> {
  if (!searchUrl.startsWith(SPOTIFY_SEARCH_PREFIX)) return null;
  const query = searchUrl.slice(SPOTIFY_SEARCH_PREFIX.length);
  if (!query) return null;

  console.log(`[Spotify] Resolving: "${query}"`);

  try {
    const result = await Promise.race([
      (async () => {
        const results = await YouTubeSearch.GetListByKeyword(query, false, 5);
        const items = results?.items as
          | Array<{
              id: string;
              type: string;
              title: string;
              length?: { simpleText: string };
            }>
          | undefined;
        const video = items?.find((item) => item.type === 'video');
        if (!video) return null;

        return {
          url: `https://www.youtube.com/watch?v=${video.id}`,
          title: video.title || query,
          duration: parseDuration(video.length?.simpleText || ''),
          thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
        } as ResolvedTrack;
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
