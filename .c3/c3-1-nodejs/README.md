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
| **Code Location** | `playground/src/` (current), `node/src/` (Discord - future) |

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

## Components

| ID | Component | Responsibility | Code Location |
|----|-----------|----------------|---------------|
| c3-101 | Discord Bot | Slash commands, Discord.js | `node/src/commands/` (future) |
| c3-102 | Voice Manager | Voice connections | `node/src/voice/` (future) |
| c3-103 | Queue Manager | Playlist state | `node/src/queue/` (future) |
| c3-104 | API Client | HTTP client to Go API | `playground/src/api-client.ts` |
| c3-105 | Socket Client | Audio stream receiver | `playground/src/socket-client.ts` |
| c3-106 | Express Server | HTTP API for browser | `playground/src/server.ts` |
| c3-107 | WebSocket Handler | Real-time browser events | `playground/src/websocket.ts` |

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
{"action": "play", "url": "https://youtube.com/..."}
{"action": "stop"}
{"action": "pause"}
{"action": "resume"}
```

### Messages to Browser

```json
{"type": "state", "debugMode": true, "isPlaying": false}
{"type": "session", "session_id": "abc123"}
{"type": "ready", "session_id": "abc123"}
{"type": "progress", "bytes": 12345, "playback_secs": 10.5}
{"type": "finished", "session_id": "abc123", "bytes": 54321}
{"type": "paused"}
{"type": "resumed"}
{"type": "stopped"}
{"type": "error", "message": "..."}
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

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20 LTS | Runtime |
| TypeScript | 5.x | Language |
| Express | 4.x | HTTP server |
| ws | 8.x | WebSocket |
| discord.js | v14 | Discord API (future) |
| @discordjs/voice | latest | Voice connections (future) |

## Directory Structure

```
playground/src/
├── index.ts           # Entry point
├── server.ts          # c3-106: Express server
├── websocket.ts       # c3-107: WebSocket handler
├── api-client.ts      # c3-104: Go API client
├── socket-client.ts   # c3-105: Socket client
└── audio-player.ts    # Debug audio output

playground/client/src/
├── App.tsx            # React main component
└── hooks/
    └── useWebSocket.ts  # React WebSocket hook
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
