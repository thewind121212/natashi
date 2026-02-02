# c3-105: Audio Processor

## Overview

The Audio Processor is the core Go component that manages the worker pool, session map, and coordinates audio processing for multiple Discord channels concurrently.

## Component Diagram

```mermaid
flowchart TB
    subgraph c3105["c3-105: Audio Processor"]
        SOCKET[Socket Server]

        subgraph WorkerPool["Worker Pool (max 60)"]
            W1[Worker 1]
            W2[Worker 2]
            W3[Worker 3]
            WN[Worker N]
        end

        SESSION_MAP[(Session Map<br/>channel_id → Worker)]
        DISPATCHER[Command Dispatcher]
    end

    NODE[Node.js<br/>Socket Client]
    C106[c3-106<br/>Stream Extractor]

    NODE <-->|Unix Socket| SOCKET
    SOCKET --> DISPATCHER
    DISPATCHER --> SESSION_MAP
    SESSION_MAP --> WorkerPool
    WorkerPool --> C106
```

## Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Socket Server | Listen on Unix sockets for commands/audio |
| Worker Pool | Manage pool of audio processing workers |
| Session Map | Route commands to correct worker by channel_id |
| Command Dispatch | Handle play/pause/resume/stop/volume |
| Resource Management | Limit concurrent workers, cleanup idle |

## Worker Pool Architecture

```mermaid
flowchart TB
    subgraph Pool["Worker Pool"]
        MANAGER[Pool Manager]

        subgraph Workers["Workers"]
            W1[Worker 1<br/>channel: 111<br/>state: playing]
            W2[Worker 2<br/>channel: 222<br/>state: paused]
            W3[Worker 3<br/>channel: 333<br/>state: playing]
        end

        QUEUE[Job Queue]
        LIMIT[Concurrency Limit: 60]
    end

    CMD[Incoming Command]

    CMD --> MANAGER
    MANAGER --> QUEUE
    QUEUE --> Workers
    MANAGER --> LIMIT
```

## Worker Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle: Worker spawned
    Idle --> Extracting: play command
    Extracting --> Streaming: extraction complete
    Extracting --> Error: extraction failed
    Streaming --> Paused: pause command
    Paused --> Streaming: resume command
    Streaming --> Idle: stop/finished
    Error --> Idle: cleanup
    Idle --> [*]: pool shrink
```

## Directory Structure

```
go/internal/
├── server/
│   ├── socket.go       # Unix socket server
│   └── handler.go      # Command handler
└── worker/
    ├── pool.go         # Worker pool management
    └── session.go      # Individual worker session
```

## Dependencies

| Depends On | Purpose |
|------------|---------|
| c3-106 Stream Extractor | Extract audio URLs |
| c3-107 Opus Encoder | Encode audio to Opus |
| c3-108 Jitter Buffer | Buffer output frames |

## Interfaces

### Session Interface

```go
type Session struct {
    ChannelID string
    State     SessionState
    Worker    *Worker
    Cancel    context.CancelFunc
}

type SessionState int

const (
    StateIdle SessionState = iota
    StateExtracting
    StateStreaming
    StatePaused
    StateError
)
```

### Worker Pool Interface

```go
type WorkerPool interface {
    // Spawn or get existing worker for channel
    GetWorker(channelID string) (*Worker, error)

    // Release worker back to pool
    ReleaseWorker(channelID string)

    // Get current worker count
    ActiveCount() int

    // Shutdown all workers
    Shutdown()
}
```

### Command Handler Interface

```go
type CommandHandler interface {
    HandlePlay(channelID, url string, volume float64) error
    HandlePause(channelID string) error
    HandleResume(channelID string) error
    HandleStop(channelID string) error
    HandleVolume(channelID string, level float64) error
}
```

## Command Flow

```mermaid
sequenceDiagram
    participant N as Node.js
    participant S as Socket Server
    participant D as Dispatcher
    participant M as Session Map
    participant W as Worker

    N->>S: {"type":"play","channel_id":"123","url":"..."}
    S->>D: Parse command
    D->>M: Lookup/create session
    M->>W: Spawn or get worker
    W->>W: Start processing
    W-->>S: {"type":"ready","channel_id":"123"}
    S-->>N: Forward event
```

## Concurrency Model

```mermaid
flowchart TB
    subgraph Goroutines["Goroutines"]
        MAIN[Main goroutine<br/>Socket accept loop]

        subgraph PerConnection["Per Connection"]
            READ[Read goroutine]
            WRITE[Write goroutine]
        end

        subgraph PerWorker["Per Worker"]
            EXTRACT[Extract goroutine]
            ENCODE[Encode goroutine]
            BUFFER[Buffer goroutine]
        end
    end

    MAIN --> PerConnection
    PerConnection --> PerWorker
```

## Resource Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Max Workers | 60 | Target concurrent channels |
| Worker Timeout | 5 minutes | Cleanup idle workers |
| Socket Buffer | 64KB | Balance memory/performance |

## Error Handling

| Error | Action |
|-------|--------|
| Pool exhausted | Return error, Node notifies user |
| Worker crash | Cleanup, send error event |
| Invalid command | Log, ignore |
| Socket error | Attempt reconnect |
