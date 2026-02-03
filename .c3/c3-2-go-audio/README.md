# C3-2: Go Audio Application (Container)

## What is a Container? (C4 Definition)

A **Container** is an application or data store - something that needs to be **running** for the system to work. It represents a runtime boundary around code being executed.

> **Note:** This is NOT a Docker container. Docker is deployment infrastructure. This C4 Container is the Go runtime process.

## Overview

The Go Audio Application is the **audio processor** of the Music Bot system. It handles stream extraction, audio encoding, and session management with high performance and low latency.

| Aspect | Value |
|--------|-------|
| **Runtime** | Go 1.21+ |
| **Role** | Audio processing, stream extraction, session management |
| **HTTP API** | Gin framework on port 8180 |
| **Audio Output** | Unix socket `/tmp/music-playground.sock` |
| **Code Location** | `internal/`, `cmd/playground/` |

## Container Diagram

```mermaid
flowchart TB
    subgraph External["External Systems"]
        YOUTUBE[YouTube]
    end

    subgraph C3_1["C3-1: Node.js Application"]
        API_CLIENT[API Client]
        SOCKET_CLIENT[Socket Client]
    end

    subgraph C3_2["C3-2: Go Audio Application"]
        c3_201[c3-201<br/>Gin API Server<br/>:8180]
        c3_202[c3-202<br/>Session Manager]
        c3_203[c3-203<br/>Stream Extractor]
        c3_204[c3-204<br/>FFmpeg Encoder]
        c3_205[c3-205<br/>Socket Server]
    end

    API_CLIENT -->|HTTP| c3_201
    c3_201 --> c3_202
    c3_202 --> c3_203
    c3_203 -->|yt-dlp| YOUTUBE
    c3_203 --> c3_204
    c3_204 --> c3_205
    c3_205 <-->|Unix Socket| SOCKET_CLIENT
```

## Components

| ID | Component | Responsibility | Code Location |
|----|-----------|----------------|---------------|
| c3-201 | Gin API Server | HTTP control endpoints | `internal/server/api.go`, `router.go` |
| c3-202 | Session Manager | Session lifecycle, pause/resume | `internal/server/session.go` |
| c3-203 | Stream Extractor | yt-dlp integration | `internal/platform/youtube/` |
| c3-204 | FFmpeg Encoder | Audio decoding/encoding pipeline | `internal/encoder/ffmpeg.go` |
| c3-205 | Socket Server | Audio streaming to Node.js | `internal/server/socket.go` |

## Component Interactions

```mermaid
flowchart LR
    c3_201[c3-201<br/>Gin API]
    c3_202[c3-202<br/>Session Manager]
    c3_203[c3-203<br/>Stream Extractor]
    c3_204[c3-204<br/>FFmpeg Encoder]
    c3_205[c3-205<br/>Socket Server]

    c3_201 -->|"StartPlayback()"| c3_202
    c3_202 -->|"ExtractStreamURL()"| c3_203
    c3_203 -->|"streamUrl"| c3_204
    c3_204 -->|"audioChunks"| c3_205
    c3_205 -->|"events"| c3_202
```

## API Endpoints (c3-201)

```mermaid
flowchart LR
    subgraph Endpoints["Gin API :8180"]
        PLAY["POST /session/:id/play"]
        STOP["POST /session/:id/stop"]
        PAUSE["POST /session/:id/pause"]
        RESUME["POST /session/:id/resume"]
        STATUS["GET /session/:id/status"]
        HEALTH["GET /health"]
    end
```

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/session/:id/play` | POST | `{url, format}` | `{status, session_id}` |
| `/session/:id/stop` | POST | - | `{status, session_id}` |
| `/session/:id/pause` | POST | - | `{status, session_id}` |
| `/session/:id/resume` | POST | - | `{status, session_id}` |
| `/session/:id/status` | GET | - | `{session_id, status, bytes_sent}` |
| `/health` | GET | - | `{status: "ok"}` |

## Session State Machine (c3-202)

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Extracting: play
    Extracting --> Streaming: ready
    Extracting --> Error: extraction failed
    Streaming --> Paused: pause
    Paused --> Streaming: resume
    Streaming --> Stopped: stop
    Paused --> Stopped: stop
    Streaming --> Stopped: finished
    Error --> [*]
    Stopped --> [*]
```

## Audio Pipeline (c3-203, c3-204)

```mermaid
flowchart LR
    subgraph Input["Input"]
        URL[YouTube URL]
    end

    subgraph c3_203["c3-203 Extractor"]
        YTDLP[yt-dlp]
        STREAM[Stream URL]
    end

    subgraph c3_204["c3-204 FFmpeg"]
        DECODE[Decode]
        RESAMPLE[Resample 48kHz]
        ENCODE[Encode PCM/Opus]
    end

    subgraph Output["Output"]
        CHUNKS[Audio Chunks]
    end

    URL --> YTDLP --> STREAM --> DECODE --> RESAMPLE --> ENCODE --> CHUNKS
```

## Socket Protocol (c3-205)

### Events (JSON, newline-delimited)

```json
{"type": "ready", "session_id": "abc123"}
{"type": "finished", "session_id": "abc123"}
{"type": "error", "session_id": "abc123", "message": "..."}
```

### Audio Data (Binary)

```
┌─────────────────────┬─────────────────────┐
│ Length (4 bytes)    │ Audio Data          │
│ Big-endian uint32   │ Variable length     │
└─────────────────────┴─────────────────────┘
```

## Concurrency Model

```mermaid
flowchart TB
    subgraph Main["Main Goroutine"]
        GIN[Gin HTTP Server]
        ACCEPT[Socket Accept Loop]
    end

    subgraph Sessions["Session Goroutines"]
        S1[Session 1<br/>goroutine]
        S2[Session 2<br/>goroutine]
        SN[Session N<br/>goroutine]
    end

    subgraph PerSession["Per Session"]
        EXTRACT[Extract URL]
        FFMPEG[FFmpeg Process]
        STREAM[Stream Audio]
    end

    GIN -->|"StartPlayback()"| Sessions
    Sessions --> PerSession
```

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Go | 1.21+ | Runtime |
| Gin | latest | HTTP framework |
| yt-dlp | latest | Stream extraction |
| FFmpeg | latest | Audio processing |

## Directory Structure

```
internal/
├── server/
│   ├── api.go           # c3-201: Gin handlers
│   ├── router.go        # c3-201: Gin routes
│   ├── session.go       # c3-202: Session manager
│   ├── socket.go        # c3-205: Socket server
│   └── types.go         # Protocol types
├── encoder/
│   ├── ffmpeg.go        # c3-204: FFmpeg pipeline
│   └── types.go         # Format definitions
└── platform/
    ├── platform.go      # c3-203: Registry
    └── youtube/
        └── youtube.go   # c3-203: yt-dlp wrapper

cmd/playground/
└── main.go              # Entry point
```

## Audio Quality Settings

| Setting | Value | Rationale |
|---------|-------|-----------|
| Sample Rate | 48000 Hz | Discord native rate |
| Channels | 2 (stereo) | Full quality |
| Frame Size | 4096 bytes | Efficient chunking |
| Format | PCM (s16le) | Playground debug |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GO_API_PORT` | `8180` | Gin HTTP port |

## See Also

- [C3-1: Node.js Application](../c3-1-nodejs/README.md) - Gateway container
- [C3-0: Context](../c3-0-context/README.md) - System context
- [Components Overview](./COMPONENTS.md) - Detailed component documentation
