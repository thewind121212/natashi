# Music Bot - Agent Knowledge Base

## What This Project Is

Discord music bot with Lavalink-quality audio streaming. Hybrid Node.js + Go architecture.

**Why hybrid?**
- Node.js: Discord API requires it (discord.js ecosystem)
- Go: Audio processing needs high-performance concurrency

## Architecture (C3 Model)

```
C3-0: Music Bot System
├── C3-1: Node.js Application (Discord Brain)
│   ├── c3-101 Discord Bot      - Slash commands
│   ├── c3-102 Voice Manager    - Voice connections
│   ├── c3-103 Queue Manager    - Playlist state
│   └── c3-104 Socket Client    - IPC to Go
│
└── C3-2: Go Audio Application (Audio Powerhouse)
    ├── c3-201 Audio Processor  - Worker pool, socket server
    ├── c3-202 Stream Extractor - yt-dlp integration
    ├── c3-203 Opus Encoder     - FFmpeg + Opus encoding
    └── c3-204 Jitter Buffer    - Frame smoothing
```

**IPC**: Unix sockets (`/tmp/music.sock` for commands, `/tmp/music-audio.sock` for audio)

## Current State

### Implemented (Go CLI POC)
- `main.go` - Entry point: extract YouTube → play via FFmpeg
- `internal/platform/youtube/` - yt-dlp extraction (works)
- `internal/player/ffmpeg/` - Direct playback to macOS AudioToolbox
- `pkg/deps/checker.go` - Dependency verification

### Not Yet Built
- Full Node.js Discord bot
- Socket server / IPC layer
- Opus encoding pipeline
- Worker pool
- Jitter buffer

## Technology Stack

| Component | Technology |
|-----------|------------|
| Discord integration | Node.js 20 + discord.js v14 |
| Audio processing | Go 1.21+ |
| Stream extraction | yt-dlp |
| Audio decoding | FFmpeg |
| Opus encoding | FFmpeg libopus |

## Key Documentation

| Path | What |
|------|------|
| `.c3/README.md` | Architecture overview |
| `.c3/c3-1-nodejs/` | Node.js container docs |
| `.c3/c3-2-go-audio/` | Go container docs |
| `docs/stories/` | Feature stories |
| `docs/plans/` | Implementation plans |

## Audio Quality Specs

| Spec | Value |
|------|-------|
| Sample Rate | 48000 Hz |
| Channels | 2 (stereo) |
| Frame Size | 20ms (960 samples) |
| Bitrate | 128 kbps VBR |
| Format | Opus |

## Current Work in Progress

### Audio Test Playground

Building a web-based audio testing tool before Discord integration.

**Story**: `docs/stories/2026-02-02-audio-test-playground.md`
**Plan**: `docs/plans/adr-20260202-audio-test-playground/`

**Key design**: Single Opus encoder with format flag:
```
                                    ┌─→ format="raw"  → Discord-ready
YouTube → FFmpeg → Opus Encoder ────┤
                                    └─→ format="webm" → Browser-playable
```

**Phases**:
1. Go Encoder (`internal/encoder/`)
2. Go Server (`internal/server/`, `cmd/playground/`)
3. Node.js (`playground/src/`)
4. Browser UI (`playground/public/`)
5. Integration testing

## How to Run (Current POC)

```bash
# Check dependencies
which yt-dlp ffmpeg

# Run CLI (plays to local speaker)
go run main.go "https://youtube.com/watch?v=..."
```

## Directory Structure

```
music-bot/
├── main.go                    # Current CLI entry
├── cmd/                       # Command entry points
│   └── cli.go                 # CLI argument parsing
├── internal/
│   ├── platform/              # Stream extraction
│   │   ├── platform.go        # Registry + interface
│   │   └── youtube/           # YouTube extractor
│   └── player/                # Audio playback
│       ├── player.go          # Interface
│       └── ffmpeg/            # FFmpeg player
├── pkg/deps/                  # Dependency checker
├── .c3/                       # Architecture docs
├── docs/
│   ├── stories/               # Feature stories
│   └── plans/                 # Implementation plans
└── playground/                # (to be created) Web test UI
```

## Design Principles

- **C3 Architecture**: Context → Container → Component (from C4)
- **SOLID**: Single responsibility, Open/closed, Interface segregation, Dependency inversion
- **Existing patterns first**: Check `.c3/` docs before implementing
