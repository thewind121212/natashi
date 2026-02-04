import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';

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
  itemRef,
}: {
  track: Track;
  index: number;
  isCurrent: boolean;
  onRemove: () => void;
  onPlay: () => void;
  itemRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={itemRef}
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

const COLLAPSED_ITEMS = 3;

export function QueueList({ queue, currentIndex, onRemove, onPlay }: QueueListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const currentItemRef = useRef<HTMLDivElement>(null);
  const canCollapse = queue.length > COLLAPSED_ITEMS;

  // Smooth scroll to current item when expanding
  useEffect(() => {
    if (isExpanded && currentItemRef.current) {
      // Delay to let animation complete
      setTimeout(() => {
        currentItemRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 300);
    }
  }, [isExpanded]);

  // Calculate visible range when collapsed - show current item with 2 items before it
  const getCollapsedRange = () => {
    if (queue.length <= COLLAPSED_ITEMS) {
      return { start: 0, end: queue.length };
    }

    // Try to show current item with 2 items before it
    let start = Math.max(0, currentIndex - 2);
    let end = start + COLLAPSED_ITEMS;

    // If end exceeds queue length, adjust to show last items
    if (end > queue.length) {
      end = queue.length;
      start = Math.max(0, end - COLLAPSED_ITEMS);
    }

    return { start, end };
  };

  const { start, end } = getCollapsedRange();
  const hiddenBefore = start;
  const hiddenAfter = queue.length - end;

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
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Queue ({queue.length} track{queue.length !== 1 ? 's' : ''})
            </CardTitle>
            {canCollapse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-muted-foreground hover:text-foreground transition-transform"
              >
                <span className={`inline-block transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                  ▼
                </span>
                <span className="ml-1">
                  {isExpanded ? 'Collapse' : `Show all (${queue.length - COLLAPSED_ITEMS} more)`}
                </span>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Collapsed view */}
          <div className={`space-y-2 transition-all duration-300 ${isExpanded ? 'hidden' : 'block'}`}>
            {/* Indicator for hidden items before */}
            {hiddenBefore > 0 && (
              <div
                className="text-xs text-muted-foreground text-center py-1 cursor-pointer hover:text-foreground transition-colors"
                onClick={() => setIsExpanded(true)}
              >
                ··· {hiddenBefore} more above ···
              </div>
            )}

            {queue.slice(start, end).map((track, i) => {
              const originalIndex = start + i;
              return (
                <QueueItem
                  key={`collapsed-${track.url}-${originalIndex}`}
                  track={track}
                  index={originalIndex}
                  isCurrent={originalIndex === currentIndex}
                  onRemove={() => onRemove(originalIndex)}
                  onPlay={() => onPlay(originalIndex)}
                />
              );
            })}

            {/* Indicator for hidden items after */}
            {hiddenAfter > 0 && (
              <div
                className="text-xs text-muted-foreground text-center py-1 cursor-pointer hover:text-foreground transition-colors"
                onClick={() => setIsExpanded(true)}
              >
                ··· {hiddenAfter} more below ···
              </div>
            )}
          </div>

          {/* Expanded view with animation */}
          <CollapsibleContent className="collapsible-content overflow-hidden">
            <ScrollArea className={queue.length > 6 ? 'h-[400px]' : 'h-auto'}>
              <div className="space-y-2 pr-4">
                {queue.map((track, index) => (
                  <QueueItem
                    key={`expanded-${track.url}-${index}`}
                    track={track}
                    index={index}
                    isCurrent={index === currentIndex}
                    onRemove={() => onRemove(index)}
                    onPlay={() => onPlay(index)}
                    itemRef={index === currentIndex ? currentItemRef : undefined}
                  />
                ))}
              </div>
            </ScrollArea>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
