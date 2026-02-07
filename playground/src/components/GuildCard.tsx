import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipForward, SkipBack,
  ListMusic, Disc, Mic2, Activity,
  Loader2, Music, X, Search,
} from 'lucide-react';
import { useBotApi } from '@/hooks/useBotApi';
import type { ActiveGuild } from '@/hooks/useGuildList';

interface SearchResult {
  id: string;
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
  channel: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || /youtu\.?be/i.test(input);
}

// --- Helpers ---

const formatTime = (seconds: number): string => {
  if (!seconds || seconds < 0) return '0:00';
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const ProgressBar = ({ current, total, onSeek, disabled }: {
  current: number;
  total: number;
  onSeek: (position: number) => void;
  disabled?: boolean;
}) => {
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const percent = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  const hoverTime = hoverPercent !== null ? (hoverPercent / 100) * total : 0;

  const getPercent = (clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * 100;
  };

  return (
    <div
      ref={barRef}
      className={`relative w-full ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      onClick={disabled ? undefined : (e) => {
        const pct = getPercent(e.clientX);
        onSeek((pct / 100) * total);
      }}
      onMouseMove={disabled ? undefined : (e) => setHoverPercent(getPercent(e.clientX))}
      onMouseLeave={() => setHoverPercent(null)}
    >
      {/* Hover time tooltip */}
      {!disabled && hoverPercent !== null && (
        <div
          className="absolute -top-7 pointer-events-none z-10"
          style={{ left: `${hoverPercent}%`, transform: 'translateX(-50%)' }}
        >
          <div className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono px-2 py-0.5 rounded-md shadow-lg whitespace-nowrap">
            {formatTime(hoverTime)}
          </div>
        </div>
      )}
      {/* Bar track */}
      <div className="relative w-full h-2 bg-slate-700/50 rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.5)] transition-all duration-100"
          style={{ width: `${percent}%` }}
        />
        {/* Hover preview fill */}
        {!disabled && hoverPercent !== null && hoverPercent > percent && (
          <div
            className="absolute top-0 h-full bg-indigo-400/20 rounded-full pointer-events-none"
            style={{ left: `${percent}%`, width: `${hoverPercent - percent}%` }}
          />
        )}
      </div>
      {/* Thumb follows cursor only while hovering — outside overflow-hidden */}
      {!disabled && hoverPercent !== null && (
        <div
          className="absolute top-1/2 -mt-2 h-4 w-4 bg-white rounded-full shadow-md pointer-events-none z-10"
          style={{ left: `${hoverPercent}%`, transform: 'translateX(-50%)' }}
        />
      )}
    </div>
  );
};

// --- Main Component ---

interface GuildCardProps {
  guild: ActiveGuild;
}

export function GuildCard({ guild }: GuildCardProps) {
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPlaybackTime, setLocalPlaybackTime] = useState(0);
  const lastServerTimeRef = useRef(0);
  const lastServerFetchRef = useRef(Date.now());

  const {
    guildState,
    isLoadingState,
    error,
    isCoolingDown,
    pause,
    resume,
    skip,
    previous,
    seek,
    jump,
    play,
    removeFromQueue,
    clearQueue,
  } = useBotApi(guild.id);

  // Search YouTube when input is not a URL
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim() || isUrl(query)) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot/search?q=${encodeURIComponent(query.trim())}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success && data.data?.results) {
        setSearchResults(data.data.results);
        setShowDropdown(true);
      } else {
        setSearchResults([]);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!value.trim() || isUrl(value)) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchDebounceRef.current = setTimeout(() => doSearch(value), 400);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectResult = (result: SearchResult) => {
    play(result.url);
    setSearchInput('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  // Sync local playback time from server state — skip while transitioning
  // so the optimistic seek position isn't overwritten by stale server data
  useEffect(() => {
    if (guildState && !guildState.isTransitioning) {
      lastServerTimeRef.current = guildState.playbackTime;
      lastServerFetchRef.current = Date.now();
      setLocalPlaybackTime(guildState.playbackTime);
    }
  }, [guildState?.playbackTime, guildState?.nowPlaying?.url, guildState?.isTransitioning]);

  // Tick local playback time every second when playing (pause tick while transitioning)
  useEffect(() => {
    if (!guildState || guildState.isPaused || !guildState.nowPlaying || guildState.isTransitioning) return;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastServerFetchRef.current) / 1000;
      setLocalPlaybackTime(lastServerTimeRef.current + elapsed);
    }, 1000);
    return () => clearInterval(interval);
  }, [guildState?.isPaused, guildState?.nowPlaying, guildState?.isTransitioning]);

  const handleSeek = (position: number) => {
    if (!guildState?.nowPlaying || isCoolingDown('seek')) return;
    // Optimistic: jump the local time immediately
    setLocalPlaybackTime(position);
    lastServerTimeRef.current = position;
    lastServerFetchRef.current = Date.now();
    seek(position);
  };

  const handlePlayPause = () => {
    if (!guildState) return;
    if (guildState.isPaused) {
      resume();
    } else if (guildState.nowPlaying) {
      pause();
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchInput.trim()) return;
    play(searchInput.trim());
    setSearchInput('');
  };

  const nowPlaying = guildState?.nowPlaying;
  const queue = guildState?.queue || [];
  const currentIndex = guildState?.currentIndex ?? -1;
  const isPaused = guildState?.isPaused ?? false;
  const isTransitioning = guildState?.isTransitioning ?? false;
  const isPlaying = !!nowPlaying && !isPaused;

  const statusText = isTransitioning ? 'Transitioning...' : isPlaying ? 'Playing' : isPaused ? 'Paused' : 'Idle';

  if (isLoadingState) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-3xl p-12 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-3xl overflow-hidden shadow-xl">
      {/* Guild Header */}
      <div className="px-8 py-5 border-b border-slate-700/50 bg-slate-900/30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-base font-bold text-white shrink-0 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
            {guild.icon}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{guild.name}</h2>
            <div className="flex items-center gap-4 mt-1">
              {guildState?.voiceChannelName && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                  <Mic2 className="w-3.5 h-3.5" /> #{guildState.voiceChannelName}
                </span>
              )}
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
                <ListMusic className="w-3.5 h-3.5" /> {queue.length} track{queue.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${
          isPlaying
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : isPaused
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-slate-500/10 border-slate-500/20 text-slate-400'
        }`}>
          {statusText}
        </span>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12">

        {/* Left: Player */}
        <div className="lg:col-span-7 p-8 flex flex-col gap-5">
          <div className="flex items-start gap-6">
            {/* Thumbnail */}
            <div className="relative w-44 h-44 rounded-2xl overflow-hidden bg-slate-700 shrink-0 shadow-lg">
              {nowPlaying?.thumbnail ? (
                <img src={nowPlaying.thumbnail} alt={nowPlaying.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Disc className="w-16 h-16 text-slate-500" />
                </div>
              )}
              {isTransitioning && (
                <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
                </div>
              )}
            </div>

            {/* Track info + controls */}
            <div className="flex-1 min-w-0 flex flex-col justify-between h-44">
              <div>
                <h3 className="text-2xl font-bold text-white truncate leading-tight">
                  {nowPlaying?.title || 'Nothing Playing'}
                </h3>
                {nowPlaying && (
                  <p className="text-sm text-slate-500 mt-2 uppercase tracking-widest font-semibold">Now Playing</p>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4">
                <button
                  onClick={previous}
                  disabled={isCoolingDown('previous') || isTransitioning || !guildState?.hasPrevious}
                  className="text-slate-300 hover:text-white hover:scale-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  <SkipBack className="w-7 h-7" />
                </button>

                <button
                  onClick={handlePlayPause}
                  disabled={isTransitioning || !nowPlaying}
                  className="w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-[0_0_25px_rgba(79,70,229,0.4)] hover:shadow-[0_0_35px_rgba(79,70,229,0.6)] hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isTransitioning ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : isPaused || !isPlaying ? (
                    <Play className="w-6 h-6 fill-current ml-0.5" />
                  ) : (
                    <Pause className="w-6 h-6 fill-current" />
                  )}
                </button>

                <button
                  onClick={skip}
                  disabled={isCoolingDown('skip') || isTransitioning || !guildState?.hasNext}
                  className="text-slate-300 hover:text-white hover:scale-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  <SkipForward className="w-7 h-7" />
                </button>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          {nowPlaying && (
            <div className="space-y-2">
              <ProgressBar
                current={localPlaybackTime}
                total={nowPlaying.duration}
                onSeek={handleSeek}
                disabled={isCoolingDown('seek') || isTransitioning}
              />
              <div className="flex justify-between text-sm font-medium text-slate-400">
                <span>{formatTime(localPlaybackTime)}</span>
                <span>{formatTime(nowPlaying.duration)}</span>
              </div>
            </div>
          )}

          {/* Inline error */}
          {error && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-xl">
              {error}
            </div>
          )}
        </div>

        {/* Right: Queue */}
        <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-slate-700/50 flex flex-col">
          {/* URL / Search Input */}
          <form onSubmit={handleSearchSubmit} className="p-5 border-b border-slate-700/50">
            <div className="relative">
              <Search className="w-4.5 h-4.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              {isSearching && (
                <Loader2 className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-indigo-400 animate-spin" />
              )}
              <input
                ref={inputRef}
                type="text"
                placeholder="Search or paste YouTube URL..."
                value={searchInput}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                className="w-full bg-slate-900/50 border border-slate-700 text-sm text-slate-200 rounded-xl pl-10 pr-10 py-2.5 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-600"
              />
              {/* Search Results Dropdown */}
              {showDropdown && searchResults.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto"
                >
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => handleSelectResult(result)}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-800 transition-colors text-left"
                    >
                      <div className="w-12 h-9 rounded-md overflow-hidden bg-slate-700 shrink-0">
                        {result.thumbnail ? (
                          <img src={result.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-4 h-4 text-slate-500" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 font-medium truncate">{result.title}</div>
                        <div className="text-xs text-slate-500 truncate">{result.channel} &middot; {formatTime(result.duration)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </form>

          {/* Queue Header */}
          <div className="px-5 py-3.5 flex justify-between items-center">
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <ListMusic className="w-4.5 h-4.5 text-indigo-400" />
              Up Next
            </h4>
            {queue.length > 0 && (
              <button
                onClick={clearQueue}
                className="text-sm text-indigo-400 hover:text-indigo-300 font-medium"
              >
                Clear
              </button>
            )}
          </div>

          {/* Queue List */}
          <div className="flex-1 overflow-y-auto px-3 pb-4 max-h-80 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                <Music className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">Queue is empty</p>
              </div>
            ) : (
              <div className="space-y-1">
                {queue.map((track, index) => {
                  const isCurrent = index === currentIndex;
                  return (
                    <div
                      key={`${track.url}-${index}`}
                      onClick={() => {
                        if (!isCurrent && !isCoolingDown('jump') && !isTransitioning) {
                          jump(index);
                        }
                      }}
                      className={`
                        group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
                        ${isCurrent
                          ? 'bg-indigo-500/15 border-2 border-indigo-500/30 shadow-[inset_0_0_20px_rgba(99,102,241,0.08)]'
                          : `border-2 border-transparent hover:bg-slate-700/40 hover:border-slate-600/50 ${isCoolingDown('jump') || isTransitioning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                      `}
                    >
                      <div className={`w-7 text-center text-sm font-bold ${isCurrent ? 'text-indigo-400' : 'text-slate-600'}`}>
                        {isCurrent && isTransitioning ? (
                          <Loader2 className="w-4 h-4 animate-spin mx-auto text-indigo-400" />
                        ) : isCurrent ? (
                          <Activity className="w-4 h-4 animate-pulse mx-auto" />
                        ) : (
                          index + 1
                        )}
                      </div>

                      <div className={`w-10 h-10 rounded-lg overflow-hidden shrink-0 ${isCurrent ? 'ring-2 ring-indigo-500/40' : 'bg-slate-700'}`}>
                        {track.thumbnail ? (
                          <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-700">
                            <Music className="w-4 h-4 text-slate-500" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${isCurrent ? 'text-indigo-200' : 'text-slate-300'}`}>
                          {track.title}
                        </div>
                      </div>

                      <div className="text-xs font-mono text-slate-500 group-hover:hidden">
                        {formatTime(track.duration)}
                      </div>
                      <div className="hidden group-hover:flex">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromQueue(index);
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
