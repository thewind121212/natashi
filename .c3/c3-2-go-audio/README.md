# C3-2: Go Audio Application (Container)

## What is a Container? (C4 Definition)

A **Container** is an application or data store - something that needs to be **running** for the system to work. It represents a runtime boundary around code being executed.

> **Note:** This is NOT a Docker container. Docker is deployment infrastructure. This C4 Container is the Go runtime process.

## Overview

The Go Audio Application is the **audio processor** of the Music Bot system. It handles stream extraction, audio encoding, and frame buffering with high performance and low latency.

| Aspect | Value |
|--------|-------|
| **Runtime** | Go 1.21+ |
| **Role** | Audio processing, stream extraction, Opus encoding |
| **Process** | Single Go process with worker pool |
| **Code Location** | `go/` |

## Container Diagram

```mermaid
flowchart TB
    subgraph External["External Systems"]
        YOUTUBE[YouTube]
    end

    subgraph C3_1["C3-1: Node.js Application"]
        NODE[Discord Integration]
    end

    subgraph C3_2["C3-2: Go Audio Application"]
        C201[c3-201<br/>Audio Processor]
        C202[c3-202<br/>Stream Extractor]
        C203[c3-203<br/>Opus Encoder]
        C204[c3-204<br/>Jitter Buffer]
    end

    NODE <-.->|Unix Socket IPC| C201
    C201 --> C202
    C202 -->|Stream URL| YOUTUBE
    YOUTUBE -->|Audio Stream| C203
    C202 --> C203
    C203 --> C204
    C204 -.->|Audio Frames| NODE
```

## Responsibilities

| Responsibility | Description |
|----------------|-------------|
| Stream Extraction | Use yt-dlp to get audio stream URLs |
| Audio Decoding | Decode audio via FFmpeg |
| Opus Encoding | Encode to Discord-compatible Opus format |
| Frame Buffering | Buffer frames for smooth delivery |
| Worker Management | Pool of workers for concurrent channels |

## Components

| ID | Component | Responsibility | Code Location |
|----|-----------|----------------|---------------|
| [c3-201](./c3-201-audio-processor/README.md) | Audio Processor | Worker pool, session management | `go/internal/server/`, `go/internal/worker/` |
| [c3-202](./c3-202-stream-extractor/README.md) | Stream Extractor | yt-dlp integration | `go/internal/extractor/` |
| [c3-203](./c3-203-opus-encoder/README.md) | Opus Encoder | FFmpeg + libopus encoding | `go/internal/encoder/` |
| [c3-204](./c3-204-jitter-buffer/README.md) | Jitter Buffer | Frame buffering, smoothing | `go/internal/buffer/` |

## Component Interactions

```mermaid
flowchart LR
    C201[c3-201<br/>Audio Processor]
    C202[c3-202<br/>Stream Extractor]
    C203[c3-203<br/>Opus Encoder]
    C204[c3-204<br/>Jitter Buffer]

    C201 -->|"extract(url)"| C202
    C202 -->|"streamUrl"| C203
    C203 -->|"opusFrame"| C204
    C204 -->|"status"| C201
```

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Go | 1.21+ | Runtime |
| yt-dlp | latest | Stream extraction |
| FFmpeg | latest | Audio decoding |
| libopus | latest | Opus encoding |

## Directory Structure

```
go/
├── cmd/
│   └── main.go              # Entry point
└── internal/
    ├── server/              # c3-201: Socket server
    │   ├── socket.go
    │   └── handler.go
    ├── worker/              # c3-201: Worker pool
    │   ├── pool.go
    │   └── session.go
    ├── extractor/           # c3-202: yt-dlp wrapper
    │   ├── ytdlp.go
    │   └── cache.go
    ├── encoder/             # c3-203: FFmpeg + Opus
    │   ├── ffmpeg.go
    │   └── opus.go
    └── buffer/              # c3-204: Jitter buffer
        └── jitter.go
```

## Communication with Node.js Application

### IPC Protocol

This container communicates with [C3-1: Node.js Application](../c3-1-nodejs/README.md) via Unix sockets:

| Socket | Direction | Format | Purpose |
|--------|-----------|--------|---------|
| `/tmp/music.sock` | Bidirectional | JSON | Commands and events |
| `/tmp/music-audio.sock` | Go → Node | Binary | Audio frames |

### Commands Received (Node → Go)

```json
{"type": "play", "channel_id": "123", "url": "https://..."}
{"type": "pause", "channel_id": "123"}
{"type": "resume", "channel_id": "123"}
{"type": "stop", "channel_id": "123"}
{"type": "volume", "channel_id": "123", "level": 0.8}
```

### Events Sent (Go → Node)

```json
{"type": "ready", "channel_id": "123", "duration": 240}
{"type": "finished", "channel_id": "123"}
{"type": "error", "channel_id": "123", "message": "..."}
```

### Audio Frame Format

```
┌──────────────┬──────────────┬─────────────────┐
│ channel_id   │ sequence     │ opus_data       │
│ (8 bytes)    │ (4 bytes)    │ (variable)      │
└──────────────┴──────────────┴─────────────────┘
```

## Audio Pipeline

```mermaid
flowchart LR
    subgraph Input["Input (Variable)"]
        I1[YouTube URL]
    end

    subgraph C202["c3-202 Extractor"]
        E1[yt-dlp]
        E2[Stream URL]
    end

    subgraph C203["c3-203 Encoder"]
        D1[FFmpeg Decode]
        D2[Resample 48kHz]
        D3[Opus Encode]
    end

    subgraph C204["c3-204 Buffer"]
        B1[Jitter Buffer]
        B2[Frame Output]
    end

    subgraph Output["Output (Fixed)"]
        O1[48kHz Stereo]
        O2[20ms Opus Frames]
    end

    Input --> C202 --> C203 --> C204 --> Output
```

## Audio Quality Requirements

| Setting | Value | Rationale |
|---------|-------|-----------|
| Sample Rate | 48000 Hz | Discord native rate |
| Channels | 2 (stereo) | Full quality |
| Frame Size | 960 samples (20ms) | Discord requirement |
| Bitrate | 128 kbps VBR | Good quality |
| Jitter Buffer | 3-5 frames | Smooth delivery |

## Concurrency Model

```mermaid
flowchart TB
    subgraph Main["Main Goroutine"]
        ACCEPT[Socket Accept Loop]
    end

    subgraph Workers["Worker Pool (max 60)"]
        W1[Worker 1<br/>channel: 111]
        W2[Worker 2<br/>channel: 222]
        WN[Worker N]
    end

    subgraph PerWorker["Per Worker Goroutines"]
        EXT[Extract]
        ENC[Encode]
        BUF[Buffer]
    end

    ACCEPT --> Workers
    Workers --> PerWorker
```

## See Also

- [C3-1: Node.js Application](../c3-1-nodejs/README.md) - The other container
- [C3-0: Context](../c3-0-context/README.md) - System context
- [Components Overview](./COMPONENTS.md) - Detailed component documentation
