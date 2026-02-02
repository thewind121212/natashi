# Table of Contents

## C3 Architecture Documentation

### Overview
- [README](./README.md) - System overview and architecture summary

### C3-0: Context Level
- [Context](./c3-0-context/README.md) - System context, actors, and boundaries

### C3-1: Container Level
- [Container Overview](./c3-1-container/README.md) - Docker container architecture

### C3-1XX: Component Level

#### Node.js Components
- [c3-101: Discord Bot](./c3-1-container/c3-101-discord-bot/README.md) - Slash commands and Discord integration
- [c3-102: Voice Manager](./c3-1-container/c3-102-voice-manager/README.md) - Voice connection handling
- [c3-103: Queue Manager](./c3-1-container/c3-103-queue-manager/README.md) - Playlist and queue state
- [c3-104: Socket Client](./c3-1-container/c3-104-socket-client/README.md) - IPC with Go layer

#### Go Components
- [c3-105: Audio Processor](./c3-1-container/c3-105-audio-processor/README.md) - Worker pool and session management
- [c3-106: Stream Extractor](./c3-1-container/c3-106-stream-extractor/README.md) - yt-dlp integration
- [c3-107: Opus Encoder](./c3-1-container/c3-107-opus-encoder/README.md) - FFmpeg and Opus encoding
- [c3-108: Jitter Buffer](./c3-1-container/c3-108-jitter-buffer/README.md) - Frame buffering and smoothing

### Architecture Decision Records
- [ADR-001: C3 Architecture Adoption](./adr/adr-001-c3-adoption.md)
