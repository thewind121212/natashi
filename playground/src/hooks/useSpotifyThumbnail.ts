import { useState, useEffect } from 'react';

const SPOTIFY_THUMB_PREFIX = 'spotify:thumb:';

// Shared cache across all component instances
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function fetchSpotifyThumbnail(trackId: string): Promise<string | null> {
  // Deduplicate concurrent requests for the same track
  if (pending.has(trackId)) {
    return pending.get(trackId)!;
  }

  const promise = fetch(
    `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`,
  )
    .then((r) => r.json())
    .then((data) => {
      const url = data.thumbnail_url || null;
      if (url) cache.set(trackId, url);
      pending.delete(trackId);
      return url;
    })
    .catch(() => {
      pending.delete(trackId);
      return null;
    });

  pending.set(trackId, promise);
  return promise;
}

// Resolves a spotify:thumb:TRACK_ID to a real image URL via Spotify oEmbed.
// For non-Spotify thumbnails, returns the original URL immediately.
export function useSpotifyThumbnail(
  thumbnail: string | undefined,
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => {
    if (!thumbnail?.startsWith(SPOTIFY_THUMB_PREFIX)) return thumbnail;
    const trackId = thumbnail.slice(SPOTIFY_THUMB_PREFIX.length);
    return cache.get(trackId);
  });

  useEffect(() => {
    if (!thumbnail?.startsWith(SPOTIFY_THUMB_PREFIX)) {
      setResolved(thumbnail);
      return;
    }

    const trackId = thumbnail.slice(SPOTIFY_THUMB_PREFIX.length);

    // Already cached
    if (cache.has(trackId)) {
      setResolved(cache.get(trackId));
      return;
    }

    // Fetch and resolve
    setResolved(undefined);
    fetchSpotifyThumbnail(trackId).then((url) => {
      if (url) setResolved(url);
    });
  }, [thumbnail]);

  return resolved;
}
