import { Button } from '@/components/ui/button';

interface Track {
  url: string;
  title: string;
  duration: number;
  thumbnail?: string;
  addedAt: string;
}

interface PlayerBarProps {
  isPlaying: boolean;
  isPaused: boolean;
  nowPlaying: Track | null;
  playbackTime: number;
  status: string;
  queueLength: number;
  currentIndex: number;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onPrevious: () => void;
  onStop: () => void;
  onClearQueue: () => void;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlayerBar({
  isPlaying,
  isPaused,
  nowPlaying,
  playbackTime,
  status,
  queueLength,
  currentIndex,
  onPause,
  onResume,
  onSkip,
  onPrevious,
  onStop,
}: PlayerBarProps) {
  const isLoading = status === 'Extracting...' || status === 'Starting...' || status === 'Loading playlist...';
  const progress = nowPlaying?.duration ? (playbackTime / nowPlaying.duration) * 100 : 0;

  // Don't show bar if nothing is playing and no track loaded
  if (!isPlaying && !nowPlaying) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      {/* Progress bar at top of player */}
      <div className="h-1 bg-zinc-800 w-full">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-300 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Main player bar */}
      <div className="bg-gradient-to-b from-zinc-900 to-black border-t border-zinc-800 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-4">

          {/* Left: Track info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Album art */}
            <div className="relative flex-shrink-0">
              {nowPlaying?.thumbnail ? (
                <img
                  src={nowPlaying.thumbnail}
                  alt=""
                  className={`w-14 h-14 rounded-md object-cover shadow-lg ${
                    isPlaying && !isPaused ? 'animate-pulse-slow' : ''
                  }`}
                />
              ) : (
                <div className={`w-14 h-14 rounded-md bg-gradient-to-br from-cyan-600 to-cyan-900 flex items-center justify-center shadow-lg ${
                  isLoading ? 'animate-pulse' : ''
                }`}>
                  <span className="text-2xl">{isLoading ? '⏳' : '🎵'}</span>
                </div>
              )}
              {/* Playing indicator */}
              {isPlaying && !isPaused && !isLoading && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center">
                  <div className="flex gap-[2px]">
                    <span className="w-[2px] h-2 bg-black rounded-full animate-bounce-bar" style={{ animationDelay: '0ms' }} />
                    <span className="w-[2px] h-2 bg-black rounded-full animate-bounce-bar" style={{ animationDelay: '150ms' }} />
                    <span className="w-[2px] h-2 bg-black rounded-full animate-bounce-bar" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Track details */}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white truncate">
                {nowPlaying?.title || 'Loading...'}
              </div>
              <div className="text-xs text-zinc-400 flex items-center gap-2">
                {isLoading ? (
                  <span className="text-cyan-400 flex items-center gap-1.5">
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading
                  </span>
                ) : (
                  <>
                    <span>{formatTime(playbackTime)}</span>
                    <span className="text-zinc-600">/</span>
                    <span>{nowPlaying?.duration ? formatTime(nowPlaying.duration) : '--:--'}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Center: Controls */}
          <div className="flex items-center gap-2">
            {/* Previous */}
            <Button
              onClick={onPrevious}
              variant="ghost"
              size="icon"
              disabled={!isPlaying || currentIndex <= 0}
              className="w-10 h-10 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-30"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </Button>

            {/* Play/Pause */}
            <Button
              onClick={isPaused ? onResume : onPause}
              disabled={!isPlaying || isLoading}
              className={`w-12 h-12 rounded-full transition-all transform hover:scale-105 ${
                isPaused
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-black'
                  : 'bg-white hover:bg-zinc-200 text-black'
              }`}
            >
              {isPaused ? (
                <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              )}
            </Button>

            {/* Next/Skip */}
            <Button
              onClick={onSkip}
              variant="ghost"
              size="icon"
              disabled={!isPlaying || currentIndex >= queueLength - 1}
              className="w-10 h-10 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-30"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </Button>
          </div>

          {/* Right: Queue info & Stop */}
          <div className="flex items-center gap-4 flex-1 justify-end">
            {/* Queue indicator */}
            {queueLength > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-zinc-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="text-xs">{queueLength} in queue</span>
              </div>
            )}

            {/* Stop button */}
            <Button
              onClick={onStop}
              variant="ghost"
              size="icon"
              disabled={!isPlaying}
              className="w-9 h-9 rounded-full text-red-400 bg-red-950/30 hover:bg-red-950/60 transition-all disabled:opacity-30"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
