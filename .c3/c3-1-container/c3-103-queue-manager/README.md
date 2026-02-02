# c3-103: Queue Manager

## Overview

The Queue Manager component maintains playlist state and track queues per guild. All queue logic lives in Node.js (the "brain").

## Component Diagram

```mermaid
flowchart TB
    subgraph c3103["c3-103: Queue Manager"]
        QM[Queue Manager]

        subgraph Queues["Guild Queues"]
            Q1[Guild 1 Queue]
            Q2[Guild 2 Queue]
            QN[Guild N Queue]
        end

        subgraph State["Queue State"]
            TRACKS[Track List]
            CURRENT[Current Track]
            POSITION[Play Position]
            LOOP[Loop Mode]
        end

        QUEUE_MAP[(Queue Map<br/>guild_id → Queue)]
    end

    C101[c3-101<br/>Discord Bot]
    C104[c3-104<br/>Socket Client]

    C101 -->|add/remove/skip| QM
    QM --> QUEUE_MAP
    QUEUE_MAP --> Queues
    Queues --> State

    QM -->|next track URL| C104
```

## Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Queue State | Maintain track queue per guild |
| Add/Remove | Add tracks, remove tracks, clear queue |
| Current Track | Track what's currently playing |
| Skip Logic | Handle skip, go to next track |
| Loop Modes | Support no-loop, loop-track, loop-queue |

## Queue State Machine

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> HasTracks: add track
    HasTracks --> Playing: play command
    Playing --> Playing: track finished (has next)
    Playing --> Empty: track finished (no next)
    Playing --> HasTracks: stop command
    HasTracks --> Empty: clear queue
```

## Directory Structure

```
node/src/queue/
├── manager.ts        # Queue manager class
├── track.ts          # Track interface
└── index.ts          # Queue exports
```

## Dependencies

| Depended By | Purpose |
|-------------|---------|
| c3-101 Discord Bot | Queue operations from commands |
| c3-104 Socket Client | Get next track when finished |

## Interfaces

### Track Interface

```typescript
interface Track {
  url: string;
  title: string;
  duration: number;      // seconds
  requestedBy: string;   // user ID
  addedAt: Date;
}
```

### Queue Interface

```typescript
interface Queue {
  guildId: string;
  tracks: Track[];
  currentIndex: number;
  loopMode: LoopMode;
}

enum LoopMode {
  None = 'none',
  Track = 'track',
  Queue = 'queue'
}
```

### Queue Manager Interface

```typescript
interface QueueManager {
  // Queue operations
  add(guildId: string, track: Track): void;
  remove(guildId: string, index: number): Track | undefined;
  clear(guildId: string): void;

  // Playback control
  getCurrent(guildId: string): Track | undefined;
  getNext(guildId: string): Track | undefined;
  skip(guildId: string): Track | undefined;

  // State
  getQueue(guildId: string): Track[];
  setLoopMode(guildId: string, mode: LoopMode): void;
}
```

## Queue Operations

```mermaid
sequenceDiagram
    participant U as User
    participant BOT as Discord Bot
    participant QM as Queue Manager
    participant SC as Socket Client

    Note over U,SC: Add Track
    U->>BOT: /play <url>
    BOT->>QM: add(guildId, track)
    QM->>QM: tracks.push(track)
    BOT->>SC: Send play command

    Note over U,SC: Skip Track
    U->>BOT: /skip
    BOT->>QM: skip(guildId)
    QM->>QM: currentIndex++
    QM-->>BOT: nextTrack
    BOT->>SC: Send stop + play next

    Note over U,SC: Track Finished
    SC->>BOT: finished event
    BOT->>QM: getNext(guildId)
    QM-->>BOT: nextTrack or undefined
    BOT->>SC: Play next or idle
```

## Loop Mode Behavior

| Mode | Behavior |
|------|----------|
| None | Play queue once, stop at end |
| Track | Repeat current track indefinitely |
| Queue | Loop entire queue when finished |

## Data Storage

- **In-Memory**: Queue state is ephemeral
- **No Persistence**: Queues reset on bot restart
- **Per-Guild**: Each guild has independent queue
