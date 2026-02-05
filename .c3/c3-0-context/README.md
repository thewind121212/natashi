# C3-0: System Context

## Overview

The Music Bot system provides high-quality audio streaming to Discord voice channels, macOS speakers (debug), and web browsers, with Lavalink-equivalent audio quality.

## Context Diagram

```mermaid
flowchart TB
    subgraph Actors["External Actors"]
        USER[Discord User]
        BROWSER[Web Browser]
        ADMIN[Bot Admin]
    end

    subgraph External["External Systems"]
        DISCORD_API[Discord API<br/>Gateway + Voice]
        YOUTUBE[YouTube<br/>Audio Source]
    end

    MUSICBOT[Music Bot<br/>System]

    USER -->|Slash Commands<br/>/play /pause /stop| DISCORD_API
    BROWSER -->|HTTP + WebSocket<br/>Control + Events| MUSICBOT
    ADMIN -->|Configuration<br/>Deployment| MUSICBOT

    DISCORD_API <-->|WebSocket + UDP<br/>Commands + Voice| MUSICBOT
    MUSICBOT -->|yt-dlp<br/>Stream URLs| YOUTUBE
```

## Actors

### Discord User
- Interacts via slash commands in Discord
- Commands: `/play`, `/pause`, `/resume`, `/stop`, `/skip`, `/list`
- Receives audio playback in voice channel
- Gets feedback via Discord embeds

### Web Browser (Playground)
- Interacts via React UI
- HTTP API for control commands
- WebSocket for real-time events
- Audio playback via Web Audio API (Ogg Opus) or local speakers (debug PCM)

### Bot Admin
- Deploys and configures the bot
- Manages bot token and permissions
- Monitors performance and logs

## External Systems

### Discord API

| Interface | Protocol | Purpose |
|-----------|----------|---------|
| Gateway | WebSocket | Commands, events, presence |
| Voice Gateway | WebSocket | Voice state, session setup |
| Voice Server | UDP | Opus audio packets |

### YouTube

| Interface | Protocol | Purpose |
|-----------|----------|---------|
| Video Page | HTTPS | Metadata extraction |
| Audio Stream | HTTPS | Raw audio data |

## System Boundaries

```mermaid
flowchart LR
    subgraph Inside["Inside System Boundary"]
        subgraph Control["Control Plane"]
            API[HTTP API]
            WS[WebSocket]
        end
        subgraph Data["Data Plane"]
            AUDIO[Audio Processing]
            STREAM[Audio Streaming]
        end
    end

    subgraph Outside["Outside System Boundary"]
        DISCORD[Discord Servers]
        YT[YouTube Servers]
        USER[End Users]
    end

    USER -->|Commands| API
    USER <-->|Events| WS
    API -->|Control| AUDIO
    AUDIO -->|Fetch| YT
    AUDIO --> STREAM
    STREAM -->|UDP| DISCORD
```

## Communication Overview

```mermaid
flowchart TB
    subgraph External["External"]
        BROWSER[Browser]
        DISCORD[Discord]
        YOUTUBE[YouTube]
    end

    subgraph System["Music Bot System"]
        subgraph C3_1["Node.js :3000"]
            EXPRESS[Express API]
            WEBSOCKET[WebSocket]
        end
        subgraph C3_2["Go :8180"]
            GIN[Gin API]
            SESSION[Sessions]
            FFMPEG[FFmpeg]
        end
    end

    BROWSER -->|HTTP| EXPRESS
    BROWSER <-->|WS| WEBSOCKET
    EXPRESS -->|HTTP| GIN
    GIN --> SESSION
    SESSION --> FFMPEG
    FFMPEG -->|yt-dlp| YOUTUBE
    SESSION -->|Socket| WEBSOCKET
```

## Quality Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Audio Latency | <20ms | Discord voice packet timing |
| Sample Rate | 48kHz | Discord native rate |
| Frame Size | 20ms | Discord Opus frame requirement |
| Jitter | <5ms | Smooth playback |
| Concurrent Sessions | 60 | Medium-scale deployment |

## Authentication + Sessions

- Discord OAuth2 runs in Node.js and issues a signed JWT in the `auth` cookie.
- WebSocket connections require a valid JWT and map to a user session (`session_id = Discord user ID`).
- Discord bot playback uses `guildId` as the `session_id`.

## Deployment Contexts

### Playground (Current)

```mermaid
flowchart LR
    subgraph Local["Local Machine"]
        VITE[Vite :5173]
        NODE[Node.js :3000]
        GO[Go :8180]
    end
    BROWSER[Browser] --> VITE
    VITE --> NODE
    NODE --> GO
```

### Production (Future)

```mermaid
flowchart LR
    subgraph Cloud["Cloud Infrastructure"]
        NODE[Node.js Container]
        GO[Go Container]
    end
    DISCORD[Discord] <--> NODE
    NODE <--> GO
```

## See Also

- [C3-1: Node.js Application](../c3-1-nodejs/README.md) - Gateway container
- [C3-2: Go Audio Application](../c3-2-go-audio/README.md) - Audio processing container
