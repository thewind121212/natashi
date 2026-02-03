import { useState, type KeyboardEvent } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { LogViewer } from '@/components/LogViewer';
import { QueueList } from '@/components/QueueList';
import { PlayerBar } from '@/components/PlayerBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const {
    isConnected,
    debugMode,
    isPaused,
    status,
    statusType,
    isPlaying,
    playbackTime,
    logs,
    queue,
    currentIndex,
    nowPlaying,
    play,
    stop,
    pause,
    resume,
    clearLogs,
    addToQueue,
    removeFromQueue,
    playFromQueue,
    skip,
    previous,
    clearQueue,
  } = useWebSocket();

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      play(url);
    }
  };

  const getStatusClass = () => {
    switch (statusType) {
      case 'error':
        return 'bg-red-950 text-red-400 border-red-800';
      case 'success':
        return 'bg-green-950 text-green-400 border-green-800';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="dark min-h-screen bg-background">
      {/* Main content with padding for bottom bar */}
      <div className="p-6 pb-28">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-cyan-400">Audio Playground</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${debugMode ? 'bg-yellow-500' : 'bg-gray-500'}`} />
                <span className="text-xs text-muted-foreground">
                  {debugMode ? 'Audio ON' : 'Audio OFF'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-muted-foreground">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>

          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Add Music</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste YouTube URL or playlist..."
                  className="flex-1"
                />
                <Button
                  onClick={() => {
                    play(url);
                    setUrl('');
                  }}
                  disabled={!url.trim()}
                  className="bg-cyan-500 text-black hover:bg-cyan-400"
                >
                  Play
                </Button>
                <Button
                  onClick={() => {
                    addToQueue(url);
                    setUrl('');
                  }}
                  disabled={!url.trim()}
                  variant="secondary"
                >
                  + Queue
                </Button>
              </div>

              {/* Status (show when not playing, or on error) */}
              {!isPlaying && !nowPlaying && (
                <div className={`rounded-lg border p-4 ${getStatusClass()}`}>
                  {status}
                </div>
              )}
              {statusType === 'error' && (
                <div className="rounded-lg border p-4 bg-red-950 text-red-400 border-red-800">
                  {status}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="mb-6">
            <QueueList
              queue={queue}
              currentIndex={currentIndex}
              onRemove={removeFromQueue}
              onPlay={playFromQueue}
            />
          </div>

          <div className="flex items-center justify-between mb-2">
            <span />
            <Button variant="ghost" size="sm" onClick={clearLogs}>
              Clear Logs
            </Button>
          </div>
          <LogViewer logs={logs} />
        </div>
      </div>

      {/* Spotify-style Player Bar */}
      <PlayerBar
        isPlaying={isPlaying}
        isPaused={isPaused}
        nowPlaying={nowPlaying}
        playbackTime={playbackTime}
        status={status}
        queueLength={queue.length}
        currentIndex={currentIndex}
        onPause={pause}
        onResume={resume}
        onSkip={skip}
        onPrevious={previous}
        onStop={stop}
        onClearQueue={clearQueue}
      />
    </div>
  );
}

export default App;
