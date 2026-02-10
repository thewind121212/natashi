import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePlayer } from '@/contexts/PlayerContext';
import type { Track, SearchResult } from '@/hooks/useWebSocket';
import { AppHeader } from '@/components/AppHeader';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Music,
  Disc,
  Loader2,
  Wifi,
  WifiOff,
  X,
  Youtube,
  Trash2,
  Volume2,
  VolumeX,
  RotateCcw,
} from 'lucide-react';

const QUEUE_ITEM_HEIGHT = 68;
const QUEUE_ITEM_GAP = 8;
const QUEUE_ITEM_STRIDE = QUEUE_ITEM_HEIGHT + QUEUE_ITEM_GAP;
const QUEUE_OVERSCAN = 6;

const formatTime = (seconds: number): string => {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const getHiResThumbnail = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  return url.replace(/\/(mq|hq|sd)default\.jpg$/, '/maxresdefault.jpg');
};

const isLikelyUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed) || /(spotify\.com|youtu\.be|youtube\.com)/i.test(trimmed);
};

interface UrlBarProps {
  urlInput: string;
  thumbnailUrl?: string | null;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPlayNow: () => void;
  onAddToQueue: () => void;
  onClear: () => void;
  canSubmit: boolean;
}

const UrlBar = memo(function UrlBar({
  urlInput,
  thumbnailUrl,
  onChange,
  onKeyDown,
  onPlayNow,
  onAddToQueue,
  onClear,
  canSubmit,
}: UrlBarProps) {
  const hasThumbnail = !!thumbnailUrl;
  return (
    <div className="flex-none px-4 md:px-8 py-4 z-30">
      <div className="max-w-6xl mx-auto flex gap-3">
        <div className="flex-1 relative">
          {hasThumbnail ? (
            <img
              src={thumbnailUrl || undefined}
              alt=""
              className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-12 rounded-md object-cover border border-slate-700"
            />
          ) : (
            <Youtube size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          )}
          <input
            type="text"
            placeholder="Paste YouTube URL or playlist..."
            className={`w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all ${
              hasThumbnail ? 'pl-16' : 'pl-11'
            }`}
            value={urlInput}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {(urlInput.trim() || hasThumbnail) && (
            <button
              type="button"
              onClick={onClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onPlayNow}
          disabled={!canSubmit}
          className="px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 flex items-center gap-2 transition-all active:scale-[0.98]"
        >
          <Play size={18} fill="currentColor" /> Play Now
        </button>
        <button
          type="button"
          onClick={onAddToQueue}
          disabled={!canSubmit}
          className="px-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-800 text-slate-200 font-semibold rounded-xl border border-slate-700 shadow-sm flex items-center gap-2 transition-all active:scale-[0.98]"
        >
          <Disc size={16} /> Add to Queue
        </button>
      </div>
    </div>
  );
});

interface PlayerHeaderProps {
  isLoading: boolean;
  status: string;
  isPlaying: boolean;
  isPaused: boolean;
  isConnected: boolean;
  statusType: 'normal' | 'error' | 'success';
}

const PlayerHeader = memo(function PlayerHeader({
  isLoading,
  status,
  isPlaying,
  isPaused,
  isConnected,
  statusType,
}: PlayerHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-8 relative z-10">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <Music size={20} className="text-indigo-400" />
          <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
            {isLoading ? status : isPlaying ? (isPaused ? 'Paused' : 'Now Playing') : 'Ready'}
          </span>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
          {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span className="text-[10px] font-bold tracking-wider">{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        </div>
      </div>
      {statusType === 'error' && (
        <span className="text-xs text-rose-400 bg-rose-500/10 px-2 py-1 rounded-md">
          {status}
        </span>
      )}
    </div>
  );
});

interface AlbumArtProps {
  nowPlaying: Track | null;
  isLoading: boolean;
  isPlaying: boolean;
  isPaused: boolean;
}

const AlbumArt = memo(function AlbumArt({ nowPlaying, isLoading, isPlaying, isPaused }: AlbumArtProps) {
  return (
    <div className="flex flex-col items-center mb-8 relative z-10">
      <div
        className="relative w-full max-w-[560px] md:max-w-[640px] mb-8 transition-transform duration-700 ease-out"
        style={{ aspectRatio: '16 / 9' }}
      >
        <div className={`w-full h-full rounded-3xl shadow-2xl overflow-hidden relative border border-white/10 ${isLoading ? 'scale-95 opacity-80' : 'scale-100 opacity-100'} transition-all duration-500`}>
          {nowPlaying?.thumbnail ? (
            <img src={getHiResThumbnail(nowPlaying.thumbnail)} alt={nowPlaying.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-slate-700 flex items-center justify-center">
              <Music size={64} className="text-slate-500" />
            </div>
          )}
          {isLoading && (
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-20">
              <Loader2 className="w-12 h-12 text-indigo-400 animate-spin" />
            </div>
          )}
        </div>
        {!isLoading && isPlaying && !isPaused && (
          <div className="absolute inset-0 rounded-3xl blur-2xl bg-indigo-500/20 -z-10 animate-pulse"></div>
        )}
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold text-white truncate max-w-md drop-shadow-lg">
          {nowPlaying?.title || 'No track selected'}
        </h1>
        {nowPlaying && (
          <p className="text-slate-400 text-sm truncate max-w-md">{nowPlaying.url}</p>
        )}
      </div>
    </div>
  );
});

interface ProgressBarProps {
  isLoading: boolean;
  isDragging: boolean;
  displayTime: number;
  duration: number;
  progressBarRef: React.RefObject<HTMLButtonElement | null>;
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (e: React.TouchEvent<HTMLButtonElement>) => void;
}

const ProgressBar = memo(function ProgressBar({
  isLoading,
  isDragging,
  displayTime,
  duration,
  progressBarRef,
  onMouseDown,
  onTouchStart,
}: ProgressBarProps) {
  const displayProgress = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div className={`w-full group ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex justify-between text-xs text-gray-400 mb-2 font-mono">
        <span>{formatTime(displayTime)}</span>
        <span>{duration ? formatTime(duration) : '0:00'}</span>
      </div>
      <button
        type="button"
        ref={progressBarRef}
        className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden cursor-pointer select-none"
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        aria-label="Seek"
      >
        <div
          className={`h-full bg-indigo-500 relative ${isDragging ? '' : 'transition-all duration-100 ease-linear'}`}
          style={{ width: `${displayProgress}%` }}
        >
          <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
        </div>
      </button>
    </div>
  );
});

interface PlayerControlsProps {
  isLoading: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  nowPlaying: Track | null;
  volume: number;
  displayTime: number;
  duration: number;
  isDragging: boolean;
  progressBarRef: React.RefObject<HTMLButtonElement | null>;
  onProgressMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onProgressTouchStart: (e: React.TouchEvent<HTMLButtonElement>) => void;
  onPlayPause: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onStop: () => void;
  onVolumeChange: (value: number) => void;
}

const PlayerControls = memo(function PlayerControls({
  isLoading,
  isPlaying,
  isPaused,
  nowPlaying,
  volume,
  displayTime,
  duration,
  isDragging,
  progressBarRef,
  onProgressMouseDown,
  onProgressTouchStart,
  onPlayPause,
  onPrevious,
  onSkip,
  onStop,
  onVolumeChange,
}: PlayerControlsProps) {
  return (
    <div className="space-y-6 relative z-10">
      <ProgressBar
        isLoading={isLoading}
        isDragging={isDragging}
        displayTime={displayTime}
        duration={duration}
        progressBarRef={progressBarRef}
        onMouseDown={onProgressMouseDown}
        onTouchStart={onProgressTouchStart}
      />

      <div className="flex items-center justify-center gap-4 md:gap-6">
        <button type="button" onClick={onPrevious} disabled={isLoading} className="p-2 text-slate-300 hover:text-white transition-colors disabled:opacity-50">
          <SkipBack size={28} fill="currentColor" />
        </button>

        <button
          type="button"
          onClick={onPlayPause}
          disabled={isLoading || !nowPlaying}
          className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg
            ${isLoading || !nowPlaying
              ? 'bg-slate-700 cursor-not-allowed shadow-none'
              : 'bg-white text-slate-900 hover:scale-105 active:scale-95 shadow-white/10'
            }`}
        >
          {isLoading ? (
            <Loader2 size={24} className="animate-spin text-slate-400" />
          ) : isPaused || !isPlaying ? (
            <Play size={28} fill="currentColor" className="ml-1" />
          ) : (
            <Pause size={28} fill="currentColor" />
          )}
        </button>

        <button type="button" onClick={onSkip} disabled={isLoading} className="p-2 text-slate-300 hover:text-white transition-colors disabled:opacity-50">
          <SkipForward size={28} fill="currentColor" />
        </button>

        <button
          type="button"
          onClick={onStop}
          className="p-2 text-slate-300 hover:text-red-400 transition-colors"
          title="Stop"
        >
          <Square size={24} fill="currentColor" />
        </button>

        <div className="flex items-center gap-2 ml-4 pl-4 border-l border-slate-700">
          <button
            type="button"
            onClick={() => onVolumeChange(volume > 0 ? 0 : 1)}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            title={volume > 0 ? 'Mute' : 'Unmute'}
          >
            {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-20 h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        </div>
      </div>
    </div>
  );
});

interface QueueItemProps {
  track: Track;
  index: number;
  isActive: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  style: React.CSSProperties;
}

const QueueItem = memo(function QueueItem({
  track,
  index,
  isActive,
  isLoading,
  isPlaying,
  onPlay,
  onRemove,
  style,
}: QueueItemProps) {
  return (
    <div
      style={style}
      className={`group flex items-center rounded-xl transition-all ${
        isActive
          ? 'bg-slate-700/60 border border-indigo-500/30'
          : 'hover:bg-slate-700/30 border border-transparent'
      }`}
    >
      <button
        type="button"
        onClick={() => onPlay(index)}
        className="flex items-center flex-1 min-w-0 p-3 text-left"
      >
        <div className="w-10 h-10 rounded-lg flex items-center justify-center mr-4 overflow-hidden relative shadow-sm bg-slate-700">
          {track.thumbnail ? (
            <img src={track.thumbnail} alt="cover" className="w-full h-full object-cover" />
          ) : (
            <Music size={16} className="text-slate-500" />
          )}
          {isActive && isLoading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Loader2 size={14} className="text-white animate-spin" />
            </div>
          )}
          {isActive && !isLoading && isPlaying && (
            <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${isActive ? 'text-indigo-400' : 'text-slate-200'}`}>
            {track.title}
          </div>
          <div className="text-xs text-slate-500 truncate">{formatTime(track.duration)}</div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="p-2 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
        aria-label="Remove from queue"
      >
        <X size={16} />
      </button>
    </div>
  );
});

interface QueuePanelProps {
  queue: Track[];
  currentIndex: number;
  isLoading: boolean;
  isPlaying: boolean;
  clearQueue: () => void;
  resetSession: () => void;
  playFromQueue: (index: number) => void;
  removeFromQueue: (index: number) => void;
}

const QueuePanel = memo(function QueuePanel({
  queue,
  currentIndex,
  isLoading,
  isPlaying,
  clearQueue,
  resetSession,
  playFromQueue,
  removeFromQueue,
}: QueuePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    setScrollTop(scrollRef.current.scrollTop);
  }, []);

  useEffect(() => {
    const updateHeight = () => {
      if (!scrollRef.current) return;
      setContainerHeight(scrollRef.current.clientHeight);
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const totalHeight = Math.max(0, queue.length * QUEUE_ITEM_STRIDE - QUEUE_ITEM_GAP);
  const startIndex = Math.max(0, Math.floor(scrollTop / QUEUE_ITEM_STRIDE) - QUEUE_OVERSCAN);
  const endIndex = Math.min(
    queue.length - 1,
    Math.ceil((scrollTop + containerHeight) / QUEUE_ITEM_STRIDE) + QUEUE_OVERSCAN,
  );

  return (
    <div className="lg:col-span-5 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 bg-slate-800/80 backdrop-blur-md rounded-3xl overflow-hidden border border-slate-700/50 shadow-xl flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-700/50 bg-slate-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Disc size={16} /> Play Queue
          </h3>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-slate-700/50 text-slate-300 text-xs font-mono border border-slate-600/50">
              {queue.length}
            </span>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={clearQueue}
                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-all"
                title="Clear Queue"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={resetSession}
              className="p-1.5 text-slate-500 hover:text-orange-400 hover:bg-orange-500/10 rounded-md transition-all"
              title="Reset Session (clear all and start fresh)"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 custom-scrollbar"
          onScroll={handleScroll}
        >
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Music size={48} className="mb-4 opacity-50" />
              <p className="text-sm">Queue is empty</p>
              <p className="text-xs mt-1">Add a YouTube URL to start</p>
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              {queue.slice(startIndex, endIndex + 1).map((track, offset) => {
                const idx = startIndex + offset;
                const isActive = idx === currentIndex;
                return (
                  <QueueItem
                    key={`${track.url}-${idx}`}
                    track={track}
                    index={idx}
                    isActive={isActive}
                    isLoading={isLoading}
                    isPlaying={isPlaying}
                    onPlay={playFromQueue}
                    onRemove={removeFromQueue}
                    style={{
                      position: 'absolute',
                      top: idx * QUEUE_ITEM_STRIDE,
                      left: 0,
                      right: 0,
                      height: QUEUE_ITEM_HEIGHT,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function AudioPlay() {
  const [urlInput, setUrlInput] = useState('');
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const toastTimeoutRef = useRef<number | null>(null);
  const progressBarRef = useRef<HTMLButtonElement>(null);
  const progressBarRectRef = useRef<DOMRect | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const lastSearchQueryRef = useRef('');

  const {
    isConnected,
    isPaused,
    status,
    statusType,
    isPlaying,
    playbackTime,
    queue,
    currentIndex,
    nowPlaying,
    volume,
    searchResults,
    isSearching,
    searchError,
    play,
    search,
    clearSearch,
    addToQueue,
    stop,
    pause,
    resume,
    removeFromQueue,
    playFromQueue,
    skip,
    previous,
    clearQueue,
    setVolume,
    resetSession,
    seek,
  } = usePlayer();

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, []);

  // Handle error toast display
  const errorStatus = statusType === 'error' ? status : null;
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!errorStatus) {
      return;
    }
    showToast(errorStatus);
  }, [errorStatus, showToast]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  // Determine loading state from status
  const isLoading = status === 'Extracting...' || status === 'Starting...' || status === 'Loading playlist...';

  const handleInputChange = useCallback((value: string) => {
    setUrlInput(value);
    if (selectedResult && value !== selectedResult.title) {
      setSelectedResult(null);
    }
  }, [selectedResult]);

  const handleClearSearch = useCallback(() => {
    setUrlInput('');
    setSelectedResult(null);
    clearSearch();
  }, [clearSearch]);

  useEffect(() => {
    const query = urlInput.trim();
    if (!query || isLikelyUrl(query) || selectedResult) {
      clearSearch();
      lastSearchQueryRef.current = '';
      return;
    }
    if (query.length < 2) {
      clearSearch();
      lastSearchQueryRef.current = '';
      return;
    }
    if (query === lastSearchQueryRef.current) return;

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      lastSearchQueryRef.current = query;
      search(query);
    }, 300);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [urlInput, search, clearSearch, selectedResult]);

  const resolveInputUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return '';
    if (selectedResult?.url) return selectedResult.url;
    if (isLikelyUrl(trimmed)) return trimmed;
    return searchResults[0]?.url || '';
  }, [selectedResult, urlInput, searchResults]);

  const handlePlayNow = useCallback(() => {
    const targetUrl = resolveInputUrl();
    if (!targetUrl) {
      if (urlInput.trim() && !isLikelyUrl(urlInput)) {
        search(urlInput.trim());
      }
      showToast('No search results');
      return;
    }
    play(targetUrl);
    setUrlInput('');
    setSelectedResult(null);
    clearSearch();
  }, [clearSearch, play, resolveInputUrl, search, showToast, urlInput]);

  const handleAddToQueue = () => {
    const targetUrl = resolveInputUrl();
    if (!targetUrl) {
      if (urlInput.trim() && !isLikelyUrl(urlInput)) {
        search(urlInput.trim());
      }
      showToast('No search results');
      return;
    }
    addToQueue(targetUrl);
    setUrlInput('');
    setSelectedResult(null);
    clearSearch();
  };

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (selectedResult && e.key === 'Backspace' && urlInput === selectedResult.title) {
      e.preventDefault();
      handleClearSearch();
      return;
    }
    if (e.key === 'Enter') {
      handlePlayNow();
    }
  }, [handleClearSearch, handlePlayNow, selectedResult, urlInput]);

  const handlePlayPause = useCallback(() => {
    if (isLoading) return;
    if (isPaused) {
      resume();
    } else if (isPlaying) {
      pause();
    } else if (queue.length > 0 && currentIndex >= 0) {
      playFromQueue(currentIndex);
    }
  }, [currentIndex, isLoading, isPaused, isPlaying, pause, playFromQueue, queue.length, resume]);

  // Progress bar seek handlers
  const dragTimeRef = useRef(0);

  const getSeekTimeFromPosition = useCallback((clientX: number): number => {
    if (!progressBarRef.current || !nowPlaying) return 0;
    const rect = progressBarRectRef.current || progressBarRef.current.getBoundingClientRect();
    if (!progressBarRectRef.current) {
      progressBarRectRef.current = rect;
    }
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = clickX / rect.width;
    return percentage * nowPlaying.duration;
  }, [nowPlaying]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!nowPlaying || isLoading) return;
    e.preventDefault();
    if (progressBarRef.current) {
      progressBarRectRef.current = progressBarRef.current.getBoundingClientRect();
    }
    const time = getSeekTimeFromPosition(e.clientX);
    setIsDragging(true);
    setDragTime(time);
    dragTimeRef.current = time;
  }, [getSeekTimeFromPosition, isLoading, nowPlaying]);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent<HTMLButtonElement>) => {
    if (!nowPlaying || isLoading) return;
    if (progressBarRef.current) {
      progressBarRectRef.current = progressBarRef.current.getBoundingClientRect();
    }
    const time = getSeekTimeFromPosition(e.touches[0].clientX);
    setIsDragging(true);
    setDragTime(time);
    dragTimeRef.current = time;
  }, [getSeekTimeFromPosition, isLoading, nowPlaying]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!progressBarRef.current || !nowPlaying) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const rect = progressBarRectRef.current || progressBarRef.current.getBoundingClientRect();
      if (!progressBarRectRef.current) {
        progressBarRectRef.current = rect;
      }
      const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percentage = clickX / rect.width;
      const time = percentage * nowPlaying.duration;
      setDragTime(time);
      dragTimeRef.current = time;
    };

    const handleEnd = () => {
      setIsDragging(false);
      progressBarRectRef.current = null;
      seek(dragTimeRef.current);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, nowPlaying, seek]);

  const displayTime = isDragging ? dragTime : playbackTime;
  const duration = nowPlaying?.duration ?? 0;
  const canSubmit = !!urlInput.trim();

  return (
    <div className="h-screen bg-slate-900 text-slate-200 font-sans flex flex-col overflow-hidden">
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 max-w-sm">
          <div className="flex items-start gap-3 bg-slate-900/90 border border-rose-500/30 text-rose-100 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md">
            <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.7)]"></div>
            <div className="text-sm leading-snug">
              <div className="font-semibold text-rose-200">Playback error</div>
              <div className="text-rose-100/90">{toastMessage.replace(/^Error:\s*/, '')}</div>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="ml-2 text-rose-200/70 hover:text-rose-100 transition-colors"
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <AppHeader />

      <div className="relative z-30">
      <UrlBar
        urlInput={urlInput}
        thumbnailUrl={selectedResult?.thumbnail || null}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onPlayNow={handlePlayNow}
        onAddToQueue={handleAddToQueue}
        onClear={handleClearSearch}
        canSubmit={canSubmit}
      />

      {!isLikelyUrl(urlInput) && !selectedResult && (isSearching || searchResults.length > 0 || searchError) && (
        <div className="absolute left-0 right-0 -mt-1">
          <div className="px-4 md:px-8">
            <div className="max-w-6xl mx-auto">
                <div className="bg-slate-900/95 border border-slate-700 rounded-xl overflow-hidden max-h-64 overflow-y-auto custom-scrollbar shadow-2xl">
                  {isSearching && searchResults.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                      <span className="text-sm">Searching...</span>
                    </div>
                  )}
                  {!isSearching && searchError && (
                    <div className="px-4 py-3 text-sm text-rose-300">{searchError}</div>
                  )}
                  {searchResults.length > 0 && (
                    <div>
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => {
                            setSelectedResult(result);
                            setUrlInput(result.title);
                            clearSearch();
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60 transition-colors text-left border-b border-slate-800 last:border-b-0"
                        >
                          <div className="w-16 h-11 rounded-lg overflow-hidden bg-slate-700 shrink-0">
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
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-slate-500 truncate">{result.channel || 'YouTube'}</span>
                              <span className="text-xs text-slate-600">&middot;</span>
                              <span className="text-xs text-slate-500 font-mono">{formatTime(result.duration)}</span>
                            </div>
                          </div>
                          <Play className="w-4 h-4 text-slate-600 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden px-4 md:px-6 pb-4 flex items-center">
        <div className="max-w-6xl mx-auto h-full max-h-[800px] grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 flex flex-col gap-6 overflow-hidden">
            <div className="bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 md:p-10 shadow-2xl border border-slate-700/50 flex flex-col justify-between h-full relative overflow-hidden">
              {nowPlaying?.thumbnail && (
                <div className="absolute inset-0 z-0">
                  <img
                    src={getHiResThumbnail(nowPlaying.thumbnail)}
                    alt="bg"
                    className="w-full h-full object-cover opacity-20 blur-[80px] scale-150 transition-opacity duration-1000"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent"></div>
                </div>
              )}

              <PlayerHeader
                isLoading={isLoading}
                status={status}
                isPlaying={isPlaying}
                isPaused={isPaused}
                isConnected={isConnected}
                statusType={statusType}
              />

              <AlbumArt
                nowPlaying={nowPlaying}
                isLoading={isLoading}
                isPlaying={isPlaying}
                isPaused={isPaused}
              />

              <PlayerControls
                isLoading={isLoading}
                isPlaying={isPlaying}
                isPaused={isPaused}
                nowPlaying={nowPlaying}
                volume={volume}
                displayTime={displayTime}
                duration={duration}
                isDragging={isDragging}
                progressBarRef={progressBarRef}
                onProgressMouseDown={handleProgressMouseDown}
                onProgressTouchStart={handleProgressTouchStart}
                onPlayPause={handlePlayPause}
                onPrevious={previous}
                onSkip={skip}
                onStop={stop}
                onVolumeChange={setVolume}
              />
            </div>
          </div>

          <QueuePanel
            queue={queue}
            currentIndex={currentIndex}
            isLoading={isLoading}
            isPlaying={isPlaying}
            clearQueue={clearQueue}
            resetSession={resetSession}
            playFromQueue={playFromQueue}
            removeFromQueue={removeFromQueue}
          />
        </div>
      </div>

    </div>
  );
}
