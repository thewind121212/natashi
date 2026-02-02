# Table of Contents

## C3 Architecture Documentation

### Overview
- [README](./README.md) - System overview and architecture summary

### C3-0: Context Level
- [Context](./c3-0-context/README.md) - System context, actors, and boundaries

### C3-1: Node.js Application (Container)
- [Container Overview](./c3-1-nodejs/README.md) - Node.js application architecture
- [Components Overview](./c3-1-nodejs/COMPONENTS.md) - Component level documentation

#### Node.js Components (c3-1XX)
- [c3-101: Discord Bot](./c3-1-nodejs/c3-101-discord-bot/README.md) - Slash commands and Discord integration
- [c3-102: Voice Manager](./c3-1-nodejs/c3-102-voice-manager/README.md) - Voice connection handling
- [c3-103: Queue Manager](./c3-1-nodejs/c3-103-queue-manager/README.md) - Playlist and queue state
- [c3-104: Socket Client](./c3-1-nodejs/c3-104-socket-client/README.md) - IPC with Go layer

### C3-2: Go Audio Application (Container)
- [Container Overview](./c3-2-go-audio/README.md) - Go application architecture
- [Components Overview](./c3-2-go-audio/COMPONENTS.md) - Component level documentation

#### Go Components (c3-2XX)
- [c3-201: Audio Processor](./c3-2-go-audio/c3-201-audio-processor/README.md) - Worker pool and session management
- [c3-202: Stream Extractor](./c3-2-go-audio/c3-202-stream-extractor/README.md) - yt-dlp integration
- [c3-203: Opus Encoder](./c3-2-go-audio/c3-203-opus-encoder/README.md) - FFmpeg and Opus encoding
- [c3-204: Jitter Buffer](./c3-2-go-audio/c3-204-jitter-buffer/README.md) - Frame buffering and smoothing

### Architecture Decision Records
- [ADR-001: C3 Architecture Adoption](./adr/adr-001-c3-adoption.md)
