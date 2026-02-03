import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface Track {
  url: string;
  title: string;
  duration: number;
  thumbnail?: string;
  addedAt: string;
}

interface QueueListProps {
  queue: Track[];
  currentIndex: number;
  onRemove: (index: number) => void;
  onPlay: (index: number) => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function QueueItem({
  track,
  index,
  isCurrent,
  onRemove,
  onPlay,
}: {
  track: Track;
  index: number;
  isCurrent: boolean;
  onRemove: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      onClick={onPlay}
      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
        isCurrent
          ? 'bg-cyan-950 border border-cyan-700'
          : 'bg-muted/50 hover:bg-muted'
      }`}
    >
      <span className="text-xs text-muted-foreground w-6 text-center">
        {isCurrent ? '▶' : index + 1}
      </span>
      {track.thumbnail && (
        <img
          src={track.thumbnail}
          alt=""
          className="w-10 h-10 rounded object-cover"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={track.title}>
          {track.title}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDuration(track.duration)}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="text-muted-foreground hover:text-red-400 h-8 w-8 p-0"
      >
        ×
      </Button>
    </div>
  );
}

export function QueueList({ queue, currentIndex, onRemove, onPlay }: QueueListProps) {
  if (queue.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            Queue is empty. Add tracks using "Add to Queue".
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">
          Queue ({queue.length} track{queue.length !== 1 ? 's' : ''})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          <div className="space-y-2 pr-4">
            {queue.map((track, index) => (
              <QueueItem
                key={`${track.url}-${index}`}
                track={track}
                index={index}
                isCurrent={index === currentIndex}
                onRemove={() => onRemove(index)}
                onPlay={() => onPlay(index)}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
