# Music Bot - C3 Architecture Documentation

## System Overview

Discord Music Bot with Lavalink-quality audio streaming. Hybrid architecture using Node.js for Discord integration and Go for high-performance audio processing.

```mermaid
flowchart TB
    subgraph External["External Systems"]
        DISCORD[Discord API]
        YOUTUBE[YouTube]
    end

    subgraph System["Music Bot System"]
        subgraph Container["Docker Container"]
            subgraph NodeJS["Node.js Layer"]
                BOT[Discord Bot]
                VOICE[Voice Manager]
                QUEUE[Queue Manager]
                SOCKET_C[Socket Client]
            end

            subgraph IPC["IPC Layer"]
                CMD_SOCK[Command Socket<br/>/tmp/music.sock]
                AUDIO_SOCK[Audio Socket<br/>/tmp/music-audio.sock]
            end

            subgraph Go["Go Layer"]
                PROCESSOR[Audio Processor]
                EXTRACTOR[Stream Extractor]
                ENCODER[Opus Encoder]
                BUFFER[Jitter Buffer]
            end
        end
    end

    DISCORD <-->|Gateway + Voice| BOT
    YOUTUBE -->|Stream URL| EXTRACTOR

    BOT --> VOICE
    BOT --> QUEUE
    VOICE --> SOCKET_C

    SOCKET_C <--> CMD_SOCK
    SOCKET_C <--> AUDIO_SOCK

    CMD_SOCK <--> PROCESSOR
    AUDIO_SOCK <--> BUFFER

    PROCESSOR --> EXTRACTOR
    EXTRACTOR --> ENCODER
    ENCODER --> BUFFER
```

## Key Characteristics

| Aspect | Description |
|--------|-------------|
| **Architecture** | Hybrid Node.js + Go in single container |
| **Audio Quality** | 48kHz stereo, 20ms Opus frames, 128kbps |
| **Latency** | <20ms Discord transfer |
| **Concurrency** | Worker pool supporting 60 channels |
| **IPC** | Unix sockets for minimal latency |

## Technology Stack

| Layer | Technology |
|-------|------------|
| Discord Integration | Node.js + discord.js v14 |
| Voice Handling | @discordjs/voice + @discordjs/opus |
| Audio Processing | Go 1.21+ |
| Stream Extraction | yt-dlp |
| Audio Encoding | FFmpeg + libopus |
| Container | Docker (Alpine base) |

## C3 Levels

| Level | Name | Description |
|-------|------|-------------|
| C3-0 | Context | System context and external actors |
| C3-1 | Container | Single Docker container with Node.js + Go |
| C3-1XX | Components | Individual components within the container |

## Quick Links

- [Context (C3-0)](./c3-0-context/README.md)
- [Container (C3-1)](./c3-1-container/README.md)
- [Architecture Decisions](./adr/)
