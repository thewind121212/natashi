import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginButton } from './components/LoginButton';
import { LoginPage } from './components/LoginPage';
import './App.css';
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
  Radio,
  Speaker,
  X,
  Youtube,
  Trash2,
} from 'lucide-react';

function PlayerApp() {
  const [urlInput, setUrlInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const {
    isConnected,
    debugMode,
    webMode,
    isPaused,
    status,
    statusType,
    isPlaying,
    playbackTime,
    queue,
    currentIndex,
    nowPlaying,
    play,
    stop,
    pause,
    resume,
    removeFromQueue,
    playFromQueue,
    skip,
    previous,
    clearQueue,
  } = useWebSocket();

  // Handle error toast display
  const errorStatus = statusType === 'error' ? status : null;
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!errorStatus) {
      return;
    }
    setToastMessage(errorStatus);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, [errorStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  // Determine loading state from status
  const isLoading = status === 'Extracting...' || status === 'Starting...' || status === 'Loading playlist...';

  // Calculate progress percentage
  const progress = nowPlaying && nowPlaying.duration > 0
    ? Math.min((playbackTime / nowPlaying.duration) * 100, 100)
    : 0;

  const handleUrlSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!urlInput.trim()) return;
    play(urlInput.trim());
    setUrlInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUrlSubmit();
    }
  };

  const handlePlayPause = () => {
    if (isLoading) return;
    if (isPaused) {
      resume();
    } else if (isPlaying) {
      pause();
    }
  };

  // Format time from seconds to M:SS
  const formatTime = (seconds: number): string => {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Upgrade YouTube thumbnail to high resolution
  const getHiResThumbnail = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    // YouTube thumbnails: mqdefault.jpg (320x180) -> maxresdefault.jpg (1280x720)
    return url.replace(/\/(mq|hq|sd)default\.jpg$/, '/maxresdefault.jpg');
  };

  // Progress bar markup (inline to access component state)
  const progressBarElement = (
    <div className={`w-full group ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex justify-between text-xs text-gray-400 mb-2 font-mono">
        <span>{formatTime(playbackTime)}</span>
        <span>{nowPlaying ? formatTime(nowPlaying.duration) : '0:00'}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 transition-all duration-100 ease-linear relative"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );

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
              onClick={() => setToastMessage(null)}
              className="ml-2 text-rose-200/70 hover:text-rose-100 transition-colors"
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Status Header */}
      <div className="flex-none p-4 md:px-8 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-40">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-2 md:order-1">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
              {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span className="text-xs font-bold tracking-wider">{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
            </div>
          </div>

          <div className="flex-1 md:order-2">
            <div className="max-w-3xl mx-auto flex gap-3">
              <div className="flex-1 relative">
                <Youtube size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Paste YouTube URL or playlist..."
                  className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <button
                onClick={() => handleUrlSubmit()}
                disabled={!urlInput.trim()}
                className="px-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 flex items-center gap-2 transition-all active:scale-[0.98]"
              >
                <Play size={18} fill="currentColor" /> Play
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 md:order-3">
            <div className="flex items-center gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${webMode ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}
              >
                <Radio size={14} /> WEB
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${debugMode && !webMode ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}
              >
                <Speaker size={14} /> MACHINE
              </div>
            </div>
            <LoginButton />
          </div>
        </div>
      </div>

      {/* Main Content - fills remaining height */}
      <div className="flex-1 overflow-hidden px-4 md:px-6 pb-4">
        <div className="max-w-6xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left Column: Player */}
        <div className="lg:col-span-7 flex flex-col gap-6 overflow-hidden">
          <div className="bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 md:p-10 shadow-2xl border border-slate-700/50 flex flex-col justify-between h-full relative overflow-hidden">

            {/* Background Ambience */}
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

            {/* Player Header */}
            <div className="flex justify-between items-center mb-8 relative z-10">
              <div className="flex items-center gap-2">
                <Music size={20} className="text-indigo-400" />
                <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                  {isLoading ? status : isPlaying ? (isPaused ? 'Paused' : 'Now Playing') : 'Ready'}
                </span>
              </div>
              {statusType === 'error' && (
                <span className="text-xs text-rose-400 bg-rose-500/10 px-2 py-1 rounded-md">
                  {status}
                </span>
              )}
            </div>

            {/* Album Art & Track Info */}
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

            {/* Controls */}
            <div className="space-y-6 relative z-10">
              {progressBarElement}

              <div className="flex items-center justify-center gap-4 md:gap-6">
                <button onClick={previous} disabled={isLoading} className="p-2 text-slate-300 hover:text-white transition-colors disabled:opacity-50">
                  <SkipBack size={28} fill="currentColor" />
                </button>

                <button
                  onClick={handlePlayPause}
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

                <button onClick={skip} disabled={isLoading} className="p-2 text-slate-300 hover:text-white transition-colors disabled:opacity-50">
                  <SkipForward size={28} fill="currentColor" />
                </button>

                <button
                  onClick={stop}
                  className="p-2 text-slate-300 hover:text-red-400 transition-colors"
                  title="Stop"
                >
                  <Square size={24} fill="currentColor" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Queue */}
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
                    onClick={clearQueue}
                    className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-all"
                    title="Clear Queue"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500">
                  <Music size={48} className="mb-4 opacity-50" />
                  <p className="text-sm">Queue is empty</p>
                  <p className="text-xs mt-1">Add a YouTube URL to start</p>
                </div>
              ) : (
                queue.map((track, idx) => {
                  const isActive = idx === currentIndex;
                  return (
                    <div
                      key={`${track.url}-${idx}`}
                      onClick={() => playFromQueue(idx)}
                      className={`group flex items-center p-3 rounded-xl transition-all cursor-pointer ${
                        isActive
                          ? 'bg-slate-700/60 border border-indigo-500/30'
                          : 'hover:bg-slate-700/30 border border-transparent'
                      }`}
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromQueue(idx);
                        }}
                        className="p-2 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(30, 41, 59, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.8);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.6);
        }
      `}</style>
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <PlayerApp />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
