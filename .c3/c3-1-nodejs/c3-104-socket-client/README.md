# c3-104: Socket Client

## Overview

The Socket Client component handles Unix socket IPC between Node.js and Go layers. It manages two sockets: one for JSON commands and one for binary Opus frames.

## Component Diagram

```mermaid
flowchart TB
    subgraph c3104["c3-104: Socket Client"]
        CLIENT[Socket Client]

        subgraph Sockets["Socket Connections"]
            CMD_SOCK[Command Socket<br/>/tmp/music.sock<br/>JSON]
            AUDIO_SOCK[Audio Socket<br/>/tmp/music-audio.sock<br/>Binary]
        end

        CMD_HANDLER[Command Handler]
        AUDIO_HANDLER[Audio Handler]
        FRAME_ROUTER[Frame Router]
    end

    C101[c3-101<br/>Discord Bot]
    C102[c3-102<br/>Voice Manager]
    C103[c3-103<br/>Queue Manager]
    GO[Go Audio Processor]

    C101 -->|send commands| CLIENT
    CLIENT <--> CMD_SOCK
    CLIENT <--> AUDIO_SOCK
    CMD_SOCK <--> GO
    AUDIO_SOCK <--> GO

    CMD_HANDLER -->|events| C101
    CMD_HANDLER -->|finished| C103
    AUDIO_HANDLER --> FRAME_ROUTER
    FRAME_ROUTER -->|opus frames| C102
```

## Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Command Transport | Send play/pause/stop/etc to Go |
| Event Handling | Receive ready/finished/error from Go |
| Audio Routing | Route Opus frames to correct Voice Manager |
| Connection Management | Connect, reconnect, handle errors |
| Frame Parsing | Parse binary frame format (channel_id + seq + opus) |

## Socket Protocol

### Command Socket (JSON)

```mermaid
sequenceDiagram
    participant N as Node.js
    participant S as /tmp/music.sock
    participant G as Go

    Note over N,G: Play Command
    N->>S: {"type":"play","channel_id":"123","url":"..."}
    S->>G: Forward
    G-->>S: {"type":"ready","channel_id":"123","duration":240}
    S-->>N: Forward

    Note over N,G: Pause Command
    N->>S: {"type":"pause","channel_id":"123"}
    S->>G: Forward
    G-->>S: {"type":"paused","channel_id":"123"}
    S-->>N: Forward

    Note over N,G: Track Finished
    G-->>S: {"type":"finished","channel_id":"123"}
    S-->>N: Forward
```

### Audio Socket (Binary)

```mermaid
flowchart LR
    subgraph Frame["Binary Frame Format"]
        CHAN[channel_id<br/>8 bytes<br/>uint64]
        SEQ[sequence<br/>4 bytes<br/>uint32]
        OPUS[opus_data<br/>variable<br/>bytes]
    end

    CHAN --> SEQ --> OPUS
```

## Directory Structure

```
app/src/
└── socket-client.ts  # Socket client
```

## Dependencies

| Depends On | Purpose |
|------------|---------|
| c3-102 Voice Manager | Send Opus frames for playback |
| c3-103 Queue Manager | Notify track finished |

| Depended By | Purpose |
|-------------|---------|
| c3-101 Discord Bot | Send playback commands |

## Interfaces

### Command Types

```typescript
// Node.js → Go
type OutgoingCommand =
  | { type: 'play'; channel_id: string; url: string; volume?: number }
  | { type: 'pause'; channel_id: string }
  | { type: 'resume'; channel_id: string }
  | { type: 'stop'; channel_id: string }
  | { type: 'volume'; channel_id: string; level: number };

// Go → Node.js
type IncomingEvent =
  | { type: 'ready'; channel_id: string; duration: number }
  | { type: 'paused'; channel_id: string }
  | { type: 'resumed'; channel_id: string }
  | { type: 'stopped'; channel_id: string }
  | { type: 'finished'; channel_id: string }
  | { type: 'error'; channel_id: string; message: string };
```

### Socket Client Interface

```typescript
interface SocketClient {
  connect(): Promise<void>;
  disconnect(): void;

  // Commands
  play(channelId: string, url: string, volume?: number): void;
  pause(channelId: string): void;
  resume(channelId: string): void;
  stop(channelId: string): void;
  setVolume(channelId: string, level: number): void;

  // Events
  on(event: 'ready', handler: (channelId: string, duration: number) => void): void;
  on(event: 'finished', handler: (channelId: string) => void): void;
  on(event: 'error', handler: (channelId: string, message: string) => void): void;
  on(event: 'audio', handler: (channelId: string, opus: Buffer) => void): void;
}
```

## Frame Routing

```mermaid
flowchart TB
    AUDIO_SOCK[Audio Socket]
    PARSE[Parse Frame]
    LOOKUP[Lookup Voice Manager<br/>by channel_id]
    FORWARD[Forward to Player]

    AUDIO_SOCK -->|binary| PARSE
    PARSE -->|channel_id, opus| LOOKUP
    LOOKUP -->|opus| FORWARD
```

## Error Handling

| Error | Action |
|-------|--------|
| Socket disconnect | Attempt reconnect with backoff |
| Parse error | Log and skip frame |
| Unknown channel_id | Log warning, discard frame |
| Go process crash | Emit error event, attempt reconnect |

## Reconnection Strategy

```mermaid
flowchart TB
    DISCONNECT[Disconnected]
    WAIT[Wait<br/>backoff delay]
    ATTEMPT[Attempt Connect]
    CHECK{Success?}
    CONNECTED[Connected]
    INCREMENT[Increment backoff<br/>max 30s]

    DISCONNECT --> WAIT
    WAIT --> ATTEMPT
    ATTEMPT --> CHECK
    CHECK -->|Yes| CONNECTED
    CHECK -->|No| INCREMENT
    INCREMENT --> WAIT
```
