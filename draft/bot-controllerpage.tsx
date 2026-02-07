import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, 
  Volume2, VolumeX, ListMusic, Music, Disc, 
  Radio, Server, Settings, LogOut, Clock,
  MoreVertical, Search, Mic2, Activity
} from 'lucide-react';

// --- Mock Data ---

const MOCK_GUILDS = [
  { id: '1', name: 'Dev Hangout', icon: 'DH', active: true },
  { id: '2', name: 'Gaming Lounge', icon: 'GL', active: false },
  { id: '3', name: 'Midnight FM', icon: 'MF', active: false },
  { id: '4', name: 'Study Group', icon: 'SG', active: false },
];

const MOCK_QUEUE = [
  { id: 1, title: "Neon Nights", artist: "Synthwave Boy", duration: 245, cover: "from-indigo-500 to-purple-500" },
  { id: 2, title: "Coding in the Rain", artist: "LoFi Beats", duration: 180, cover: "from-emerald-500 to-teal-500" },
  { id: 3, title: "Boss Battle Theme", artist: "RPG Soundtracks", duration: 310, cover: "from-rose-500 to-orange-500" },
  { id: 4, title: "Space Voyage", artist: "Stellar Drifter", duration: 420, cover: "from-slate-500 to-gray-500" },
  { id: 5, title: "Coffee Shop Vibes", artist: "Morning Jazz", duration: 200, cover: "from-amber-500 to-yellow-500" },
];

// --- Helper Components ---

const Button = ({ children, variant = 'primary', size = 'md', className = '', onClick }) => {
  const baseStyle = "rounded-xl font-medium transition-all duration-200 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900";
  
  const variants = {
    primary: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] focus:ring-indigo-500",
    secondary: "bg-slate-700/50 hover:bg-slate-600/50 text-slate-200 border border-slate-600/50 focus:ring-slate-500",
    ghost: "bg-transparent hover:bg-slate-800/50 text-slate-400 hover:text-indigo-400",
    danger: "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20"
  };

  const sizes = {
    sm: "p-2",
    md: "px-4 py-2",
    lg: "p-4",
    icon: "w-10 h-10"
  };

  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
};

const ProgressBar = ({ current, total, onSeek }) => {
  const percent = (current / total) * 100;
  
  return (
    <div className="group relative w-full h-1.5 bg-slate-700/50 rounded-full cursor-pointer" onClick={onSeek}>
      <div 
        className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-100"
        style={{ width: `${percent}%` }}
      />
      {/* Thumb (only visible on hover/group-hover) */}
      <div 
        className="absolute top-1/2 -mt-1.5 h-3 w-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
        style={{ left: `${percent}%`, transform: 'translateX(-50%)' }}
      />
    </div>
  );
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// --- Main Application ---

export default function App() {
  const [activeGuild, setActiveGuild] = useState(MOCK_GUILDS[0]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(45); // Start at 45s for demo
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const currentSong = MOCK_QUEUE[currentSongIndex];

  // Simulation of music playing
  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= currentSong.duration) {
            handleNext();
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSong, currentSongIndex]);

  const handleNext = () => {
    setCurrentSongIndex((prev) => (prev + 1) % MOCK_QUEUE.length);
    setCurrentTime(0);
  };

  const handlePrev = () => {
    setCurrentSongIndex((prev) => (prev - 1 + MOCK_QUEUE.length) % MOCK_QUEUE.length);
    setCurrentTime(0);
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">
      
      {/* --- Sidebar Navigation --- */}
      <aside 
        className={`${isSidebarOpen ? 'w-20 lg:w-72' : 'w-20'} flex flex-col border-r border-slate-700/50 bg-slate-900/80 backdrop-blur-md transition-all duration-300 z-20`}
      >
        <div className="p-6 flex items-center justify-center lg:justify-start gap-3 h-20">
          <div className="relative">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.5)]">
              <Radio className="text-white w-6 h-6" />
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-900"></span>
          </div>
          {isSidebarOpen && (
            <h1 className="hidden lg:block text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              PlayBot
            </h1>
          )}
        </div>

        {/* Guild List */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 scrollbar-hide">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 hidden lg:block">
            {isSidebarOpen ? 'Active Guilds' : 'Guilds'}
          </div>
          
          {MOCK_GUILDS.map((guild) => (
            <div 
              key={guild.id}
              onClick={() => setActiveGuild(guild)}
              className={`
                group flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all duration-200
                ${activeGuild.id === guild.id 
                  ? 'bg-slate-800/80 border border-slate-700/50 shadow-lg' 
                  : 'hover:bg-slate-800/40 border border-transparent'}
              `}
            >
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-transform group-hover:scale-105
                ${activeGuild.id === guild.id ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}
              `}>
                {guild.icon}
              </div>
              
              {isSidebarOpen && (
                <div className="hidden lg:flex flex-col flex-1 min-w-0">
                  <span className={`text-sm font-medium truncate ${activeGuild.id === guild.id ? 'text-white' : 'text-slate-300'}`}>
                    {guild.name}
                  </span>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    {activeGuild.id === guild.id ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Activity className="w-3 h-3" /> Connected
                      </span>
                    ) : 'Idle'}
                  </span>
                </div>
              )}
            </div>
          ))}

          <div className="my-4 border-t border-slate-800/50"></div>
          
          <button className="w-full flex items-center gap-3 p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded-xl transition-colors">
            <div className="w-10 h-10 rounded-full border border-dashed border-slate-600 flex items-center justify-center">
              <Play className="w-4 h-4" />
            </div>
            {isSidebarOpen && <span className="hidden lg:block text-sm">Add Bot to Server</span>}
          </button>
        </div>

        {/* User / Settings Footer */}
        <div className="p-4 border-t border-slate-700/50 bg-slate-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-rose-400"></div>
              {isSidebarOpen && (
                <div className="hidden lg:block">
                  <p className="text-sm font-medium text-slate-200">ClydeBotDev</p>
                  <p className="text-[10px] text-slate-500 font-mono" title="Discord ID: 123456789012345678">ID: 123456789...</p>
                </div>
              )}
            </div>
            {isSidebarOpen && (
              <button className="hidden lg:block text-slate-400 hover:text-white transition-colors">
                <Settings className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* --- Main Content Area --- */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Background decorative blobs */}
        <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-rose-500/5 rounded-full blur-3xl pointer-events-none"></div>

        {/* Header */}
        <header className="h-20 border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-400" />
              {activeGuild.name}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              /play active
            </span>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="relative hidden md:block">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Search songs..." 
                  className="bg-slate-800 border border-slate-700 text-sm text-slate-200 rounded-full pl-10 pr-4 py-1.5 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 w-64 placeholder:text-slate-600"
                />
             </div>
             <Button variant="ghost" size="icon"><LogOut className="w-5 h-5" /></Button>
          </div>
        </header>

        {/* Dashboard Content Grid */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* LEFT COLUMN: Player (8 cols) */}
            <div className="xl:col-span-8 flex flex-col gap-6">
              
              {/* Hero Player Card */}
              <div className="relative overflow-hidden rounded-3xl bg-slate-800/40 border border-slate-700/50 backdrop-blur-xl p-6 md:p-10 flex flex-col md:flex-row items-center gap-8 shadow-2xl">
                {/* Album Art with Glow */}
                <div className="relative group shrink-0">
                  <div className={`absolute -inset-4 bg-gradient-to-tr ${currentSong.cover} opacity-30 blur-xl group-hover:opacity-50 transition-opacity duration-500 animate-pulse`}></div>
                  <div className={`relative w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl bg-gradient-to-br ${currentSong.cover} flex items-center justify-center transform group-hover:scale-[1.02] transition-transform duration-300`}>
                    <Disc className={`w-24 h-24 text-white/80 ${isPlaying ? 'animate-spin-slow' : ''}`} />
                  </div>
                </div>

                {/* Track Info & Controls */}
                <div className="flex-1 w-full flex flex-col justify-center text-center md:text-left z-10">
                  <div className="mb-6 space-y-1">
                    <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight drop-shadow-md line-clamp-1">{currentSong.title}</h1>
                    <p className="text-lg text-indigo-300 font-medium">{currentSong.artist}</p>
                    <p className="text-xs text-slate-500 mt-2 uppercase tracking-widest font-semibold">Now Playing</p>
                  </div>

                  {/* Progress Bar Component */}
                  <div className="space-y-2 mb-6 group">
                    <ProgressBar current={currentTime} total={currentSong.duration} onSeek={() => {}} />
                    <div className="flex justify-between text-xs font-medium text-slate-400 group-hover:text-slate-300 transition-colors">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(currentSong.duration)}</span>
                    </div>
                  </div>

                  {/* Main Controls */}
                  <div className="flex items-center justify-center md:justify-start gap-4 md:gap-6">
                    <button className="text-slate-400 hover:text-indigo-400 transition-colors"><Shuffle className="w-5 h-5" /></button>
                    <button onClick={handlePrev} className="text-slate-200 hover:text-white hover:scale-110 transition-all"><SkipBack className="w-8 h-8" /></button>
                    
                    <button 
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-16 h-16 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-[0_0_25px_rgba(79,70,229,0.4)] hover:shadow-[0_0_35px_rgba(79,70,229,0.6)] hover:scale-105 transition-all duration-200"
                    >
                      {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                    </button>
                    
                    <button onClick={handleNext} className="text-slate-200 hover:text-white hover:scale-110 transition-all"><SkipForward className="w-8 h-8" /></button>
                    <button className="text-slate-400 hover:text-indigo-400 transition-colors"><Repeat className="w-5 h-5" /></button>
                  </div>
                </div>
              </div>

              {/* Quick Actions / Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-4 hover:border-indigo-500/30 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase font-bold">Uptime</div>
                      <div className="text-slate-200 font-mono">14h 32m</div>
                    </div>
                 </div>
                 <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-4 hover:border-indigo-500/30 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <Mic2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase font-bold">Voice Channel</div>
                      <div className="text-slate-200">#music-lounge</div>
                    </div>
                 </div>
                 <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-4 hover:border-indigo-500/30 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <ListMusic className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase font-bold">Queue Length</div>
                      <div className="text-slate-200">{MOCK_QUEUE.length} Tracks</div>
                    </div>
                 </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Queue (4 cols) */}
            <div className="xl:col-span-4 flex flex-col h-full min-h-[400px]">
              <div className="bg-slate-800/80 border border-slate-700/50 backdrop-blur-xl rounded-2xl flex flex-col h-full shadow-lg overflow-hidden">
                <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/30">
                   <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                     <ListMusic className="w-5 h-5 text-indigo-400" />
                     Up Next
                   </h3>
                   <button className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">Clear Queue</button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
                  <div className="space-y-1">
                    {MOCK_QUEUE.map((track, index) => {
                      const isCurrent = index === currentSongIndex;
                      return (
                        <div 
                          key={track.id}
                          className={`
                            group flex items-center gap-3 p-3 rounded-xl transition-all duration-200 border border-transparent
                            ${isCurrent 
                              ? 'bg-indigo-600/10 border-indigo-500/20 shadow-[inset_0_0_20px_rgba(99,102,241,0.1)]' 
                              : 'hover:bg-slate-700/30 hover:border-slate-700'}
                          `}
                        >
                          <div className={`
                            w-8 text-center text-xs font-bold
                            ${isCurrent ? 'text-indigo-400' : 'text-slate-600'}
                          `}>
                            {isCurrent ? <Activity className="w-4 h-4 animate-pulse mx-auto" /> : index + 1}
                          </div>
                          
                          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${track.cover} shrink-0`}></div>
                          
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium truncate ${isCurrent ? 'text-indigo-300' : 'text-slate-300'}`}>
                              {track.title}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{track.artist}</div>
                          </div>
                          
                          <div className="text-xs font-mono text-slate-500 group-hover:hidden">
                            {formatTime(track.duration)}
                          </div>
                          <div className="hidden group-hover:flex gap-1">
                             <button className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors">
                                <LogOut className="w-3 h-3 rotate-180" /> {/* Simulate Remove Icon */}
                             </button>
                             <button className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors">
                                <MoreVertical className="w-3 h-3" />
                             </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Empty State Suggestion */}
                  <div className="mt-8 text-center p-6 border-2 border-dashed border-slate-700/50 rounded-xl bg-slate-800/20">
                    <p className="text-sm text-slate-400 mb-2">Want to add more?</p>
                    <Button variant="secondary" size="sm" className="w-full text-xs">
                      <Search className="w-3 h-3 mr-2" /> Search Tracks
                    </Button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
