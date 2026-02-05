# C3-1: Node.js Application (Container)

> Part of the [C3 Architecture](./../README.md) based on the [C4 Model](https://c4model.com/)

## What is a Container? (C4 Definition)

A **Container** is an application or data store - something that needs to be **running** for the system to work. It represents a runtime boundary around code being executed.

> **Note:** This is NOT a Docker container. Docker is deployment infrastructure. This C4 Container is the Node.js runtime process.

## Overview

The Node.js Application is the **brain/orchestrator** of the Music Bot system. It handles browser/Discord interactions, sends control commands to Go, and relays audio events back to clients.

| Aspect | Value |
|--------|-------|
| **Runtime** | Node.js 20 LTS |
| **Role** | Gateway, Discord integration, state management |
| **HTTP Server** | Express on port 3000 |
| **Code Location** | `app/src/` |

## Container Diagram

```mermaid
flowchart TB
    subgraph External["External"]
        BROWSER[Browser]
        DISCORD[Discord API]
    end

    subgraph C3_1["C3-1: Node.js Application :3000<br/>(Brain - Orchestrator)"]
        c3_101[c3-101<br/>Discord Bot]
        c3_102[c3-102<br/>Voice Manager]
        c3_103[c3-103<br/>Queue Manager]
        c3_104[c3-104<br/>API Client]
        c3_105[c3-105<br/>Socket Client]
        c3_106[c3-106<br/>Express Server]
        c3_107[c3-107<br/>WebSocket Handler]
    end

    subgraph C3_2["C3-2: Go Audio Application<br/>(Audio Engine)"]
        GO_API[Gin API :8180]
        GO_SOCKET[Unix Socket]
    end

    BROWSER -->|HTTP| c3_106
    BROWSER <-->|WebSocket| c3_107
    DISCORD <-->|Gateway| c3_101
    c3_101 --> c3_102
    c3_101 --> c3_103
    c3_102 --> c3_104
    c3_104 -->|"Control: play/stop/pause"| GO_API
    GO_SOCKET -->|"Data: audio chunks + events"| c3_105
    c3_107 <--> c3_105
```

## Communication Pattern

| Channel | Direction | What | Protocol |
|---------|-----------|------|----------|
| **Control Plane** | Node.js → Go | Commands (play, stop, pause, resume) | HTTP REST :8180 |
| **Data Plane** | Go → Node.js | Audio chunks + events (ready, progress, finished) | Unix Socket |

> **Node.js is the brain**: It tells Go what to do. Go processes audio and streams it back.

## Session Identity + Auth

- Browser sessions are authenticated via Discord OAuth2 and a JWT stored in the `auth` cookie.
- WebSocket connections require a valid JWT and map to a user session (`session_id = Discord user ID`).
- Discord bot playback uses `guildId` as the `session_id`.

## Components

| ID | Component | Responsibility | Code Location |
|----|-----------|----------------|---------------|
| c3-101 | Discord Bot | Slash commands, Discord.js | `app/src/commands/` |
| c3-102 | Voice Manager | Voice connections | `app/src/voice/` |
| c3-103 | Queue Manager | Playlist state, track navigation | `app/src/queue-manager.ts` |
| c3-104 | API Client | HTTP client to Go API | `app/src/api-client.ts` |
| c3-105 | Socket Client | Audio stream receiver | `app/src/socket-client.ts` |
| c3-106 | Express Server | HTTP API for browser | `app/src/server.ts` |
| c3-107 | WebSocket Handler | Real-time browser events, queue sync | `app/src/websocket.ts` |

## Component Interactions

```mermaid
flowchart LR
    c3_106[c3-106<br/>Express]
    c3_107[c3-107<br/>WebSocket]
    c3_104[c3-104<br/>API Client]
    c3_105[c3-105<br/>Socket Client]

    c3_106 -->|"proxy"| c3_104
    c3_107 -->|"control"| c3_104
    c3_107 <-->|"audio/events"| c3_105
```

## HTTP Endpoints (c3-106)

```mermaid
flowchart LR
    subgraph Endpoints["Express API :3000"]
        PLAY["POST /api/session/:id/play"]
        STOP["POST /api/session/:id/stop"]
        PAUSE["POST /api/session/:id/pause"]
        RESUME["POST /api/session/:id/resume"]
        STATUS["GET /api/session/:id/status"]
        HEALTH["GET /api/go/health"]
    end
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session/:id/play` | POST | Proxy to Go - start playback |
| `/api/session/:id/stop` | POST | Proxy to Go - stop playback |
| `/api/session/:id/pause` | POST | Proxy to Go - pause |
| `/api/session/:id/resume` | POST | Proxy to Go - resume |
| `/api/session/:id/status` | GET | Proxy to Go - get status |
| `/api/go/health` | GET | Check Go API health |

## WebSocket Protocol (c3-107)

### Messages from Browser

```json
// Playback control
{"action": "play", "url": "https://youtube.com/..."}
{"action": "stop"}
{"action": "pause"}
{"action": "resume"}

// Queue management
{"action": "addToQueue", "url": "https://youtube.com/..."}
{"action": "removeFromQueue", "index": 0}
{"action": "playFromQueue", "index": 2}
{"action": "skip"}
{"action": "previous"}
{"action": "clearQueue"}
{"action": "getQueue"}
```

### Messages to Browser

```json
// Connection state (sent on connect)
{"type": "state", "debugMode": true, "isPlaying": false, "isPaused": false, "queue": [], "currentIndex": -1, "nowPlaying": null}

// Playback events
{"type": "session", "session_id": "abc123"}
{"type": "ready", "session_id": "abc123"}
{"type": "progress", "bytes": 12345, "playback_secs": 10.5}
{"type": "finished", "session_id": "abc123", "bytes": 54321}
{"type": "paused"}
{"type": "resumed"}
{"type": "stopped"}
{"type": "error", "message": "..."}

// Queue events
{"type": "queueUpdated", "queue": [...], "currentIndex": 2, "nowPlaying": {...}}
{"type": "nowPlaying", "nowPlaying": {"url": "...", "title": "...", "duration": 180, "thumbnail": "..."}}
{"type": "queueFinished"}

// Logs
{"type": "log", "source": "go|nodejs", "message": "..."}
```

## Data Flow (Playground)

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as c3-107<br/>WebSocket
    participant API as c3-104<br/>API Client
    participant SC as c3-105<br/>Socket Client
    participant GO as C3-2<br/>Go

    B->>WS: {action: "play", url}
    WS->>API: play(sessionId, url)
    API->>GO: POST /session/:id/play
    GO-->>API: {status: "playing"}
    GO-->>SC: {type: "ready"}
    SC-->>WS: event
    WS-->>B: {type: "ready"}
    GO-->>SC: audio chunks
    SC-->>WS: audio data
    WS-->>B: {type: "progress"}
```

## Core Flows

### Discord Bot (Opus)

```mermaid
sequenceDiagram
    participant User as Discord User
    participant Bot as c3-101
    participant API as c3-104
    participant Go as C3-2
    participant Voice as c3-102

    User->>Bot: /play url
    Bot->>API: play(guildId, url, opus)
    API->>Go: POST /session/:guildId/play
    Go-->>Bot: Ogg Opus over socket
    Bot->>Voice: playStream(ogg/opus)
```

### Debug PCM (macOS speakers)

```mermaid
sequenceDiagram
    participant Browser as Playground UI
    participant WS as c3-107
    participant API as c3-104
    participant Go as C3-2
    participant Audio as AudioPlayer

    Browser->>WS: play(url)
    WS->>API: play(userId, url, pcm)
    API->>Go: POST /session/:userId/play
    Go-->>WS: PCM over socket
    WS->>Audio: ffplay PCM
```

### Browser Web Audio (Ogg Opus)

```mermaid
sequenceDiagram
    participant Browser as Playground UI
    participant WS as c3-107
    participant API as c3-104
    participant Go as C3-2

    Browser->>WS: play(url)
    WS->>API: play(userId, url, web)
    API->>Go: POST /session/:userId/play
    Go-->>WS: Ogg Opus over socket
    WS-->>Browser: binary WebSocket
```

## Constraints

- Discord voice connections are tracked per guild; one active voice connection per guild at a time.
- Current Go implementation stops all existing sessions on `StartPlayback`, so only one session can stream at a time across all sources.

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20 LTS | Runtime |
| TypeScript | 5.x | Language |
| Express | 4.x | HTTP server |
| ws | 8.x | WebSocket |
| discord.js | v14 | Discord API |
| @discordjs/voice | latest | Voice connections |

## Directory Structure

```
app/src/
├── index.ts           # Entry point
├── config.ts          # Configuration
├── server.ts          # c3-106: Express server
├── websocket.ts       # c3-107: WebSocket handler
├── api-client.ts      # c3-104: Go API client
├── socket-client.ts   # c3-105: Socket client
├── queue-manager.ts   # c3-103: Queue manager
├── audio-player.ts    # Debug audio output
├── commands/          # c3-101: Discord bot commands
│   ├── index.ts
│   ├── play.ts
│   └── stop.ts
├── voice/             # c3-102: Voice manager
│   └── manager.ts
└── tests/

playground/src/        # React UI (Vite)
├── App.tsx
├── components/
│   ├── PlayerBar.tsx  # Spotify-style bottom player bar
│   ├── QueueList.tsx  # Collapsible queue with track list
│   ├── LogViewer.tsx  # Server log viewer with tabs
│   └── ui/            # Shadcn UI components
└── hooks/
    └── useWebSocket.ts
```

## Communication with Go Application

### Control Plane (HTTP)

Node.js sends control commands to Go API:

```mermaid
flowchart LR
    BROWSER[Browser] -->|HTTP :3000| EXPRESS[Express]
    EXPRESS -->|HTTP :8180| GIN[Gin API]
```

### Data Plane (Socket)

Node.js receives audio/events from Go:

```mermaid
flowchart LR
    GO[Go Session] -->|Binary + JSON| SOCKET[Unix Socket]
    SOCKET -->|Events| NODE[Node.js]
    NODE -->|WebSocket| BROWSER[Browser]
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GO_API_PORT` | `8180` | Go API port to connect to |
| `DEBUG_AUDIO` | `0` | Enable audio playback to speakers |

## See Also

- [C3-2: Go Audio Application](../c3-2-go-audio/README.md) - Audio processing container
- [C3-0: System Context](../c3-0-context/README.md) - System context
- [Components Overview](./COMPONENTS.md) - Detailed component documentation
