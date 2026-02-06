# Web Player Polish - Diagrams

## System Overview (After Changes)

```mermaid
flowchart TB
    subgraph Browser["Browser (React)"]
        UI[App.tsx]
        HOOK[useWebSocket]
        AUDIO[useAudioPlayer]
        GAIN[GainNode]
        VOL_SLIDER[Volume Slider]
        RESET_BTN[Reset Button]
    end

    subgraph Node["Node.js"]
        WS[WebSocket Handler<br/>c3-107]
        SS[Session Store]
        QM[Queue Manager<br/>c3-103]
        DB[(SQLite)]
    end

    subgraph Go["Go (Unchanged)"]
        GO_API[Gin API :8180]
    end

    VOL_SLIDER --> GAIN
    AUDIO --> GAIN -->|audio| SPEAKERS[Speakers]

    RESET_BTN --> HOOK
    HOOK -->|WebSocket| WS

    WS --> SS
    SS <--> DB
    QM -.->|persist event| SS
    WS --> GO_API
```

## Persistence Flow

### Server Startup

```mermaid
sequenceDiagram
    participant Main as index.ts
    participant SQLite as SqliteStore
    participant SS as SessionStore
    participant QM as QueueManager

    Main->>SQLite: new SqliteStore()
    SQLite->>SQLite: init() - CREATE TABLE IF NOT EXISTS
    Main->>SS: new SessionStore(sqliteStore)
    SS->>SQLite: loadAllSessions()
    SQLite-->>SS: [{userId, queue, currentIndex, ...}, ...]

    loop For each saved session
        SS->>QM: new QueueManager()
        SS->>QM: Restore tracks from queue JSON
    end

    Note over SS: Sessions restored to memory
```

### Queue Change Persistence

```mermaid
sequenceDiagram
    participant Browser
    participant WS as WebSocket
    participant QM as QueueManager
    participant SS as SessionStore
    participant DB as SQLite

    Browser->>WS: {action: "play", url}
    WS->>QM: addTrack(url, title, ...)
    QM->>QM: emitUpdate()
    QM-->>WS: 'update' event
    QM-->>SS: 'persist' event

    Note over SS: Debounce 100ms
    SS->>DB: saveSession(userId, {queue, currentIndex, ...})
    DB-->>SS: OK

    WS-->>Browser: {type: "queueUpdated", queue: [...]}
```

### User Reconnect (Restore)

```mermaid
sequenceDiagram
    participant Browser
    participant WS as WebSocket
    participant SS as SessionStore

    Browser->>WS: WebSocket connect (with JWT)
    WS->>SS: getOrCreate(userId)

    alt Session exists in memory (restored from DB)
        SS-->>WS: Existing session with queue
    else New user
        SS->>SS: Create new empty session
        SS-->>WS: Empty session
    end

    WS-->>Browser: {type: "state", queue: [...], currentIndex, ...}
    Note over Browser: UI shows restored queue
```

## Volume Control Flow

```mermaid
sequenceDiagram
    participant Slider as Volume Slider
    participant Hook as useWebSocket
    participant Audio as useAudioPlayer
    participant Ctx as AudioContext
    participant Gain as GainNode

    Note over Slider,Gain: User drags volume to 70%
    Slider->>Hook: onChange(0.7)
    Hook->>Hook: setVolume(0.7)
    Hook->>Audio: setVolume(0.7)
    Audio->>Gain: gain.setTargetAtTime(0.7, now, 0.01)

    Note over Gain: Smooth 10ms transition
    Gain-->>Ctx: Audio at 70% volume
    Ctx-->>SPEAKERS: Output
```

## Reset Session Flow

```mermaid
sequenceDiagram
    participant Browser
    participant WS as WebSocket
    participant API as ApiClient
    participant GO as Go API
    participant SS as SessionStore
    participant QM as QueueManager
    participant DB as SQLite

    Browser->>WS: {action: "resetSession"}

    alt Has active playback
        WS->>API: stop(sessionId)
        API->>GO: POST /session/:id/stop
        GO-->>API: OK
    end

    WS->>WS: resetPlaybackState(session)
    WS->>QM: clear()
    QM->>QM: queue = [], currentIndex = -1
    QM-->>WS: 'update' event

    WS->>SS: resetSession(userId)
    SS->>DB: DELETE FROM user_sessions WHERE user_id = ?

    WS-->>Browser: {type: "sessionReset"}
    Note over Browser: UI resets to initial state
```

## Audio Pipeline (with GainNode)

```mermaid
flowchart LR
    subgraph useAudioPlayer["useAudioPlayer Hook"]
        WS_DATA[WebSocket Binary]
        DECODER[OggOpusDecoder]
        BUFFER[Buffer Queue]
        SOURCE[AudioBufferSourceNode]
        GAIN[GainNode<br/>volume: 0-1]
        DEST[AudioContext.destination]
    end

    WS_DATA --> DECODER
    DECODER --> BUFFER
    BUFFER --> SOURCE
    SOURCE --> GAIN
    GAIN --> DEST
    DEST --> SPEAKERS[Speakers]

    VOL_SLIDER[Volume Slider] -.->|setVolume| GAIN
```

## State Machine: Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Empty: User connects
    Empty --> HasQueue: play/addToQueue
    HasQueue --> Playing: Start playback
    Playing --> Paused: pause
    Paused --> Playing: resume
    Playing --> HasQueue: Track finished
    HasQueue --> Empty: clearQueue
    Playing --> Empty: resetSession
    HasQueue --> Empty: resetSession
    Paused --> Empty: resetSession

    note right of Empty: Queue empty\nNo playback
    note right of HasQueue: Queue has tracks\nNot playing
    note right of Playing: Active playback
    note right of Paused: Paused playback

    Empty --> [*]: Disconnect
    HasQueue --> [*]: Disconnect
    Playing --> [*]: Disconnect
    Paused --> [*]: Disconnect
```

## Component Integration

```mermaid
flowchart TB
    subgraph ReactLayer["React (Browser)"]
        subgraph Hooks
            useWebSocket
            useAudioPlayer
        end
        subgraph Components
            App[App.tsx]
        end
    end

    subgraph NodeLayer["Node.js"]
        subgraph C3_107["c3-107"]
            WebSocketHandler
        end
        subgraph Infrastructure
            SessionStore
            SqliteStore
        end
        subgraph C3_103["c3-103"]
            QueueManager
        end
    end

    App --> useWebSocket
    useWebSocket --> useAudioPlayer
    useWebSocket <-->|WebSocket| WebSocketHandler
    WebSocketHandler --> SessionStore
    SessionStore --> QueueManager
    SessionStore <--> SqliteStore
    QueueManager -.->|persist| SessionStore
```

## UI Layout (Volume + Reset)

```
+----------------------------------------------------------+
| [Wifi] CONNECTED    [URL input...          ] [Play]  [WEB] |
+----------------------------------------------------------+
|                                                          |
|   +--------------------------------------------------+   |
|   |                                                  |   |
|   |              [Album Art / Thumbnail]             |   |
|   |                                                  |   |
|   +--------------------------------------------------+   |
|                                                          |
|              Track Title                                  |
|              0:45 ─────●───────────────── 3:21           |
|                                                          |
|      [⏮] [⏸] [⏭] [⏹]   🔊 ═══════●═══  <── Volume      |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|   Play Queue                    [3] [🔄] [🗑] <── Reset  |
|   ┌────────────────────────────────────────────────┐     |
|   │ ▶ Track 1 - Now Playing                   [×]  │     |
|   │   Track 2                                 [×]  │     |
|   │   Track 3                                 [×]  │     |
|   └────────────────────────────────────────────────┘     |
|                                                          |
+----------------------------------------------------------+
```
