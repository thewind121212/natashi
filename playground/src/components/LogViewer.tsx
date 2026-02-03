import { useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface LogEntry {
  timestamp: string;
  source: 'go' | 'nodejs';
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
}

function LogLine({ log }: { log: LogEntry }) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <span className="text-muted-foreground">{log.timestamp}</span>
      {' '}
      <span className={log.source === 'go' ? 'text-cyan-400' : 'text-green-400'}>
        [{log.source === 'go' ? 'Go' : 'Node'}]
      </span>
      {' '}
      <span className="text-foreground">{log.message}</span>
    </div>
  );
}

function LogList({ logs }: { logs: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <ScrollArea className="h-[500px] w-full rounded-md border bg-black/50 p-4" ref={scrollRef}>
      <div className="space-y-1">
        {logs.length === 0 ? (
          <div className="text-muted-foreground text-sm">No logs yet...</div>
        ) : (
          logs.map((log, i) => <LogLine key={i} log={log} />)
        )}
      </div>
    </ScrollArea>
  );
}

export function LogViewer({ logs }: LogViewerProps) {
  const goLogs = logs.filter((l) => l.source === 'go');
  const nodeLogs = logs.filter((l) => l.source === 'nodejs');

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Server Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">
              All ({logs.length})
            </TabsTrigger>
            <TabsTrigger value="go">
              Go ({goLogs.length})
            </TabsTrigger>
            <TabsTrigger value="nodejs">
              Node.js ({nodeLogs.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <LogList logs={logs} />
          </TabsContent>
          <TabsContent value="go">
            <LogList logs={goLogs} />
          </TabsContent>
          <TabsContent value="nodejs">
            <LogList logs={nodeLogs} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
