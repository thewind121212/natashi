// Spotify URL resolver - resolves Spotify tracks/playlists/albums to YouTube URLs
// Used by both web playground (websocket.ts) and Discord bot (play.ts)

import * as YouTubeSearch from 'youtube-search-api';

export interface ResolvedTrack {
  url: string;
  title: string;
  duration: number;
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
  subtitle: string; // artist
  duration: number; // milliseconds
  isPlayable: boolean;
}

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

export function getSpotifyType(url: string): 'track' | 'playlist' | 'album' | null {
  const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?(track|playlist|album)\//);
  return match ? (match[1] as 'track' | 'playlist' | 'album') : null;
}

// Extract the Spotify resource path (e.g. "playlist/37i9dQZF1DXcBWIGoYBM5M")
function getSpotifyEmbedPath(url: string): string | null {
  const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

// Fetch Spotify oEmbed data (public, no auth needed)
async function fetchOEmbed(spotifyUrl: string): Promise<SpotifyOEmbed | null> {
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
    const response = await fetch(oembedUrl);
    if (!response.ok) return null;
    return (await response.json()) as SpotifyOEmbed;
  } catch {
    return null;
  }
}

// Fetch track list from Spotify embed page (__NEXT_DATA__ JSON)
async function fetchSpotifyEmbedTracks(spotifyUrl: string): Promise<SpotifyEmbedTrack[]> {
  const embedPath = getSpotifyEmbedPath(spotifyUrl);
  if (!embedPath) return [];

  const embedUrl = `https://open.spotify.com/embed/${embedPath}`;
  const response = await fetch(embedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok) return [];

  const html = await response.text();
  const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!scriptMatch) return [];

  try {
    const data = JSON.parse(scriptMatch[1]);
    const trackList = data?.props?.pageProps?.state?.data?.entity?.trackList;
    if (Array.isArray(trackList)) {
      return trackList.filter((t: SpotifyEmbedTrack) => t.isPlayable && t.title);
    }
  } catch {
    // JSON parse failed
  }
  return [];
}

// Search YouTube and return best match
async function searchYouTube(query: string): Promise<ResolvedTrack | null> {
  try {
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
    };
  } catch {
    return null;
  }
}

// Resolve a single Spotify track → YouTube URL via oEmbed
async function resolveTrack(spotifyUrl: string): Promise<ResolvedTrack | null> {
  const oembed = await fetchOEmbed(spotifyUrl);
  if (!oembed?.title) return null;

  // oEmbed title format: "Track Name - Artist"
  const searchQuery = oembed.title;
  console.log(`[Spotify] Resolving track: "${searchQuery}"`);

  return searchYouTube(searchQuery);
}

// Resolve Spotify playlist/album → array of YouTube tracks
// Uses the Spotify embed page to get track list (no auth required)
async function resolvePlaylist(
  spotifyUrl: string,
  onProgress?: (resolved: number, total: number) => void,
): Promise<ResolvedTrack[]> {
  console.log(`[Spotify] Extracting playlist tracks from embed page...`);

  let spotifyTracks: SpotifyEmbedTrack[];
  try {
    spotifyTracks = await fetchSpotifyEmbedTracks(spotifyUrl);
  } catch (err) {
    console.error(`[Spotify] Embed extraction failed:`, err);
    return [];
  }

  if (spotifyTracks.length === 0) {
    console.log(`[Spotify] No tracks found in playlist`);
    return [];
  }

  console.log(`[Spotify] Found ${spotifyTracks.length} tracks, searching YouTube...`);

  // Search YouTube for each track with concurrency limit
  const CONCURRENCY = 3;
  const resolved: ResolvedTrack[] = [];
  let completed = 0;

  for (let i = 0; i < spotifyTracks.length; i += CONCURRENCY) {
    const batch = spotifyTracks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((t) => {
        const query = t.subtitle ? `${t.title} ${t.subtitle}` : t.title;
        return searchYouTube(query);
      }),
    );

    for (const result of results) {
      if (result) resolved.push(result);
    }

    completed += batch.length;
    onProgress?.(completed, spotifyTracks.length);
  }

  console.log(`[Spotify] Resolved ${resolved.length}/${spotifyTracks.length} tracks`);
  return resolved;
}

// Main entry: resolve any Spotify URL to YouTube track(s)
export async function resolveSpotifyUrl(
  url: string,
  onProgress?: (resolved: number, total: number) => void,
): Promise<ResolvedTrack[]> {
  const type = getSpotifyType(url);
  if (!type) return [];

  if (type === 'track') {
    const track = await resolveTrack(url);
    return track ? [track] : [];
  }

  // playlist or album
  return resolvePlaylist(url, onProgress);
}
