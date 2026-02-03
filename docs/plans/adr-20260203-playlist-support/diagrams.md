# Playlist Support Diagrams

## System Context with Queue

```mermaid
flowchart TB
    subgraph External["External"]
        USER[Browser User]
        YT[YouTube]
    end

    subgraph System["Music Bot Playground"]
        subgraph NodeJS["Node.js :3000"]
            WS[WebSocket Handler]
            QM[Queue Manager<br/>NEW]
            API[API Client]
        end

        subgraph Go["Go :8180"]
            GIN[Gin API]
            SESSION[Session Manager]
            EXTRACT[Stream Extractor]
        end
    end

    USER -->|"addToQueue, skip, clear"| WS
    WS --> QM
    WS --> API
    API -->|"play, metadata"| GIN
    GIN --> SESSION
    GIN --> EXTRACT
    EXTRACT -->|yt-dlp| YT
```

## Add to Queue Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as WebSocket
    participant QM as QueueManager
    participant API as ApiClient
    participant Go as Go Server
    participant YT as YouTube

    B->>WS: {action: "addToQueue", url}
    WS->>API: getMetadata(url)
    API->>Go: GET /metadata?url=...
    Go->>YT: yt-dlp --get-title --get-duration
    YT-->>Go: title, duration
    Go-->>API: {title, duration, thumbnail}
    API-->>WS: metadata
    WS->>QM: addTrack(url, metadata)
    QM-->>WS: queue updated
    WS-->>B: {type: "queueUpdated", queue}

    alt Queue was empty
        WS->>API: play(sessionId, url)
        API->>Go: POST /session/:id/play
        Go-->>WS: {type: "ready"}
        WS-->>B: {type: "ready"}
    end
```

## Auto-Advance Flow

```mermaid
sequenceDiagram
    participant Go as Go Server
    participant SC as SocketClient
    participant WS as WebSocket
    participant QM as QueueManager
    participant API as ApiClient
    participant B as Browser

    Go-->>SC: {type: "finished", session_id}
    SC-->>WS: event: finished
    WS->>QM: currentFinished()
    QM->>QM: currentIndex++

    alt Has next track
        QM-->>WS: nextTrack
        WS->>API: play(sessionId, nextTrack.url)
        API->>Go: POST /session/:id/play
        WS-->>B: {type: "queueUpdated", queue, currentIndex}
        Go-->>WS: {type: "ready"}
        WS-->>B: {type: "ready"}
    else Queue empty
        QM-->>WS: null
        WS-->>B: {type: "queueFinished"}
    end
```

## Skip Track Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as WebSocket
    participant QM as QueueManager
    participant API as ApiClient
    participant Go as Go Server

    B->>WS: {action: "skip"}
    WS->>API: stop(sessionId)
    API->>Go: POST /session/:id/stop
    Go-->>API: {status: "stopped"}
    WS->>QM: skip()
    QM->>QM: currentIndex++

    alt Has next track
        QM-->>WS: nextTrack
        WS->>API: play(sessionId, nextTrack.url)
        API->>Go: POST /session/:id/play
        WS-->>B: {type: "queueUpdated"}
    else Queue empty
        WS-->>B: {type: "queueFinished"}
    end
```

## Queue State Machine

```mermaid
stateDiagram-v2
    [*] --> Empty: Initialize

    Empty --> HasTracks: addTrack()
    HasTracks --> Empty: clear() / last track removed

    state HasTracks {
        [*] --> Idle
        Idle --> Playing: play first track
        Playing --> Playing: skip() / finished
        Playing --> Paused: pause()
        Paused --> Playing: resume()
        Playing --> Idle: stop()
    }
```

## Queue Manager Class Diagram

```mermaid
classDiagram
    class Track {
        +string url
        +string title
        +number duration
        +string thumbnail
        +Date addedAt
    }

    class QueueManager {
        -Track[] queue
        -number currentIndex
        -EventEmitter events
        +addTrack(url, metadata) void
        +removeTrack(index) void
        +skip() Track|null
        +clear() void
        +getQueue() Track[]
        +getCurrentTrack() Track|null
        +getNextTrack() Track|null
        +isEmpty() boolean
        +onQueueUpdated(callback) void
        -emitUpdate() void
    }

    QueueManager "1" --> "*" Track : contains
```

## Component Integration

```mermaid
flowchart TB
    subgraph Browser["Browser (React)"]
        APP[App.tsx]
        HOOK[useWebSocket.ts]
        QLIST[QueueList.tsx]
        QITEM[QueueItem.tsx]
    end

    subgraph NodeJS["Node.js (Playground)"]
        INDEX[index.ts]
        SERVER[server.ts]
        WS[websocket.ts]
        QM[queue-manager.ts]
        API[api-client.ts]
        SOCK[socket-client.ts]
    end

    subgraph Go["Go Audio Server"]
        ROUTER[router.go]
        APIHANDLER[api.go]
        YOUTUBE[youtube.go]
    end

    APP --> HOOK
    APP --> QLIST
    QLIST --> QITEM
    HOOK <-->|WebSocket| WS
    INDEX --> SERVER
    INDEX --> WS
    WS --> QM
    WS --> API
    WS --> SOCK
    API -->|HTTP| ROUTER
    ROUTER --> APIHANDLER
    APIHANDLER --> YOUTUBE

    style QM fill:#90EE90
    style QLIST fill:#90EE90
    style QITEM fill:#90EE90
```

## WebSocket Message Flow

```mermaid
flowchart LR
    subgraph BrowserToNode["Browser → Node.js"]
        A1[addToQueue]
        A2[removeFromQueue]
        A3[skip]
        A4[clearQueue]
        A5[getQueue]
        A6[play]
        A7[stop]
        A8[pause]
        A9[resume]
    end

    subgraph NodeToBrowser["Node.js → Browser"]
        B1[queueUpdated]
        B2[queueFinished]
        B3[state]
        B4[session]
        B5[ready]
        B6[finished]
        B7[error]
        B8[progress]
    end

    style A1 fill:#90EE90
    style A2 fill:#90EE90
    style A3 fill:#90EE90
    style A4 fill:#90EE90
    style A5 fill:#90EE90
    style B1 fill:#90EE90
    style B2 fill:#90EE90
```

## Audio Flow (Unchanged)

```mermaid
flowchart LR
    subgraph Go["Go Audio Server"]
        YT[yt-dlp] --> FF[FFmpeg]
        FF --> SOCKET[Unix Socket]
    end

    subgraph NodeJS["Node.js"]
        SOCKET --> SOCKCLIENT[Socket Client]
        SOCKCLIENT --> PLAYER[Audio Player]
    end

    PLAYER --> SPEAKERS[macOS Speakers]
```

## File Structure After Implementation

```
playground/
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── api-client.ts          # +getMetadata()
│   ├── socket-client.ts
│   ├── websocket.ts           # +queue actions
│   ├── queue-manager.ts       # NEW
│   └── audio-player.ts
├── client/
│   └── src/
│       ├── App.tsx            # +queue UI
│       ├── hooks/
│       │   └── useWebSocket.ts # +queue state
│       └── components/
│           ├── QueueList.tsx  # NEW
│           ├── QueueItem.tsx  # NEW
│           └── ui/
```
