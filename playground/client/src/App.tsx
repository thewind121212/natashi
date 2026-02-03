import { useState, type KeyboardEvent } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { LogViewer } from '@/components/LogViewer';
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
    logs,
    play,
    stop,
    pause,
    resume,
    clearLogs,
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
    <div className="dark min-h-screen bg-background p-6">
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
            <CardTitle className="text-lg">Player Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste YouTube URL here..."
                className="flex-1"
              />
              <Button
                onClick={() => play(url)}
                disabled={!url.trim()}
                className="bg-cyan-500 text-black hover:bg-cyan-400"
              >
                Play
              </Button>
            </div>

            <div className="flex gap-3">
              {isPlaying && !isPaused && (
                <Button
                  onClick={pause}
                  variant="secondary"
                  className="flex-1"
                >
                  ⏸ Pause
                </Button>
              )}
              {isPlaying && isPaused && (
                <Button
                  onClick={resume}
                  className="flex-1 bg-green-600 hover:bg-green-500"
                >
                  ▶ Resume
                </Button>
              )}
              {isPlaying && (
                <Button
                  onClick={stop}
                  variant="destructive"
                  className="flex-1"
                >
                  ⏹ Stop
                </Button>
              )}
            </div>

            <div className={`rounded-lg border p-4 ${getStatusClass()}`}>
              {status}
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground">Usage:</strong><br />
              <code className="text-xs bg-black/30 px-1 rounded">task run</code> - No audio output<br />
              <code className="text-xs bg-black/30 px-1 rounded">task run:debug</code> - Audio plays to macOS speakers
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mb-2">
          <span />
          <Button variant="ghost" size="sm" onClick={clearLogs}>
            Clear Logs
          </Button>
        </div>
        <LogViewer logs={logs} />
      </div>
    </div>
  );
}

export default App;
