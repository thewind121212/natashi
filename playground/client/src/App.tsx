import { useState, type KeyboardEvent } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { LogViewer } from '@/components/LogViewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const {
    isConnected,
    debugMode,
    status,
    statusType,
    isPlaying,
    logs,
    play,
    stop,
    setDebugMode,
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
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-muted-foreground">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Player Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border bg-card p-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="debug"
                  checked={debugMode}
                  onCheckedChange={setDebugMode}
                />
                <label htmlFor="debug" className="cursor-pointer select-none">
                  Debug Mode (play to macOS speakers)
                </label>
              </div>
              <span className="text-xs text-muted-foreground">Enable to hear audio</span>
            </div>

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
                disabled={isPlaying}
                className="bg-cyan-500 text-black hover:bg-cyan-400"
              >
                Play
              </Button>
              <Button
                onClick={stop}
                disabled={!isPlaying}
                variant="destructive"
              >
                Stop
              </Button>
            </div>

            <div className={`rounded-lg border p-4 ${getStatusClass()}`}>
              {status}
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground">Flow:</strong><br />
              Browser → Node.js → Go → FFmpeg → PCM audio → Node.js → [if debug] macOS speakers
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
