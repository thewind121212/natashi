# Table of Contents

## C3 Architecture Documentation

> Based on the [C4 Model](https://c4model.com/) - Context, Container, Component

### Overview
- [README](./README.md) - System overview and architecture summary

### C3-0: System Context Level
- [Context](./c3-0-context/README.md) - System context, actors, and boundaries

---

### C3-1: Node.js Application (Container)
- [Container Overview](./c3-1-nodejs/README.md) - Node.js application architecture
- [Components Overview](./c3-1-nodejs/COMPONENTS.md) - Component level documentation

#### Node.js Components (c3-1XX)

| ID | Component | Description |
|----|-----------|-------------|
| [c3-101](./c3-1-nodejs/c3-101-discord-bot/README.md) | Discord Bot | Slash commands and Discord.js integration |
| [c3-102](./c3-1-nodejs/c3-102-voice-manager/README.md) | Voice Manager | @discordjs/voice connections |
| [c3-103](./c3-1-nodejs/c3-103-queue-manager/README.md) | Queue Manager | Playlist and queue state |
| [c3-104](./c3-1-nodejs/c3-104-api-client/README.md) | API Client | HTTP client to Go API |
| [c3-105](./c3-1-nodejs/c3-105-socket-client/README.md) | Socket Client | Unix socket audio receiver |
| [c3-106](./c3-1-nodejs/c3-106-express-server/README.md) | Express Server | HTTP API for playground |
| [c3-107](./c3-1-nodejs/c3-107-websocket-handler/README.md) | WebSocket Handler | Real-time browser events |

---

### C3-2: Go Audio Application (Container)
- [Container Overview](./c3-2-go-audio/README.md) - Go application architecture
- [Components Overview](./c3-2-go-audio/COMPONENTS.md) - Component level documentation

#### Go Components (c3-2XX)

| ID | Component | Description |
|----|-----------|-------------|
| [c3-201](./c3-2-go-audio/c3-201-gin-api-server/README.md) | Gin API Server | HTTP control endpoints |
| [c3-202](./c3-2-go-audio/c3-202-session-manager/README.md) | Session Manager | Session lifecycle management |
| [c3-203](./c3-2-go-audio/c3-203-stream-extractor/README.md) | Stream Extractor | yt-dlp integration |
| [c3-204](./c3-2-go-audio/c3-204-opus-encoder/README.md) | Opus Encoder | FFmpeg + libopus pipeline |
| [c3-205](./c3-2-go-audio/c3-205-jitter-buffer/README.md) | Jitter Buffer | Frame buffering and smoothing |
| [c3-206](./c3-2-go-audio/c3-206-socket-server/README.md) | Socket Server | Audio streaming to Node.js |

---

### Architecture Decision Records
- [ADR-001: C3 Architecture Adoption](./adr/adr-001-c3-adoption.md)
