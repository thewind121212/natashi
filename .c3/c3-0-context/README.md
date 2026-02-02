# C3-0: System Context

## Overview

The Music Bot system provides high-quality audio streaming to Discord voice channels, with Lavalink-equivalent audio quality.

## Context Diagram

```mermaid
flowchart TB
    subgraph Actors["External Actors"]
        USER[Discord User]
        ADMIN[Bot Admin]
    end

    subgraph External["External Systems"]
        DISCORD_API[Discord API<br/>Gateway + Voice]
        YOUTUBE[YouTube<br/>Audio Source]
    end

    MUSICBOT[Music Bot<br/>System]

    USER -->|Slash Commands<br/>/play /pause /stop| MUSICBOT
    ADMIN -->|Configuration<br/>Deployment| MUSICBOT

    MUSICBOT <-->|WebSocket + UDP<br/>Commands + Voice| DISCORD_API
    MUSICBOT -->|HTTP<br/>Stream URLs| YOUTUBE
```

## Actors

### Discord User
- Interacts via slash commands in Discord
- Commands: `/play`, `/pause`, `/resume`, `/stop`, `/skip`, `/list`
- Receives audio playback in voice channel
- Gets feedback via Discord embeds

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
        CMD[Command Processing]
        QUEUE[Queue Management]
        AUDIO[Audio Processing]
        VOICE[Voice Transmission]
    end

    subgraph Outside["Outside System Boundary"]
        DISCORD[Discord Servers]
        YT[YouTube Servers]
        USER[End Users]
    end

    USER -->|Commands| CMD
    CMD -->|Queue ops| QUEUE
    QUEUE -->|Play requests| AUDIO
    AUDIO -->|Opus frames| VOICE
    VOICE -->|UDP| DISCORD

    AUDIO -->|Fetch| YT
```

## Quality Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Audio Latency | <20ms | Discord voice packet timing |
| Sample Rate | 48kHz | Discord native rate |
| Frame Size | 20ms | Discord Opus frame requirement |
| Jitter | <5ms | Smooth playback |
| Concurrent Channels | 60 | Medium-scale deployment |
