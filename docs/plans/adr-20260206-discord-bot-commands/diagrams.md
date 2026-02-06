# Discord Bot Commands Diagrams

## 1. Current vs New Architecture

### Current (No Queue)

```mermaid
sequenceDiagram
    participant U as Discord User
    participant Bot as Discord Bot
    participant Voice as Voice Manager
    participant Go as Go API

    U->>Bot: /play url1
    Bot->>Voice: join + play
    Bot->>Go: play(guildId, url1)
    Note over Voice: Playing url1

    U->>Bot: /play url2
    Bot->>Go: stop(guildId)
    Bot->>Go: play(guildId, url2)
    Note over Voice: url1 interrupted!<br/>Now playing url2

    Note over Go: Track finishes
    Go-->>Bot: event: finished
    Bot->>Voice: stop
    Note over Voice: Silence<br/>No auto-advance
```

### New (With Queue)

```mermaid
sequenceDiagram
    participant U as Discord User
    participant Bot as Discord Bot
    participant Store as Session Store
    participant Voice as Voice Manager
    participant Go as Go API

    U->>Bot: /play url1
    Bot->>Store: addTrack(url1)
    Bot->>Store: startPlaying(0)
    Bot->>Voice: join + play
    Bot->>Go: play(guildId, url1)
    Note over Voice: Playing url1

    U->>Bot: /play url2
    Bot->>Store: addTrack(url2)
    Note over Store: Queue: [url1*, url2]
    Bot-->>U: "Added to queue"
    Note over Voice: Still playing url1

    Note over Go: Track finishes
    Go-->>Bot: event: finished
    Bot->>Store: currentFinished()
    Store-->>Bot: url2
    Bot->>Go: play(guildId, url2)
    Note over Voice: Auto-advance to url2
```

## 2. Command Flows

### /pause Flow

```mermaid
sequenceDiagram
    participant U as User
    participant Bot as Bot
    participant Store as Store
    participant API as API Client
    participant Go as Go

    U->>Bot: /pause
    Bot->>Store: get(guildId)

    alt Not playing
        Bot-->>U: "Not playing anything"
    else Already paused
        Bot-->>U: "Already paused"
    else Playing
        Bot->>Store: isPaused = true
        Bot->>API: pause(guildId)
        API->>Go: POST /session/:id/pause
        Go-->>API: {status: "paused"}
        Bot-->>U: "Paused"
    end
```

### /resume Flow

```mermaid
sequenceDiagram
    participant U as User
    participant Bot as Bot
    participant Store as Store
    participant API as API Client
    participant Go as Go

    U->>Bot: /resume
    Bot->>Store: get(guildId)

    alt Not paused
        Bot-->>U: "Not paused"
    else Paused
        Bot->>Store: isPaused = false
        Bot->>API: resume(guildId)
        API->>Go: POST /session/:id/resume
        Go-->>API: {status: "playing"}
        Bot-->>U: "Resumed"
    end
```

### /skip Flow

```mermaid
sequenceDiagram
    participant U as User
    participant Bot as Bot
    participant Store as Store
    participant Socket as Socket Client
    participant API as API Client
    participant Voice as Voice Manager

    U->>Bot: /skip
    Bot->>Store: queueManager.skip()

    alt No next track
        Bot-->>U: "No more tracks"
    else Has next
        Store-->>Bot: nextTrack
        Bot->>Socket: endStream(guildId)
        Bot->>API: stop(guildId)
        Bot->>Socket: createStream(guildId)
        Bot->>Voice: playStream(guildId, stream)
        Bot->>API: play(guildId, nextTrack.url)
        Bot->>Store: currentTrack = nextTrack
        Bot-->>U: "Now playing: {title}"
    end
```

### /queue Flow

```mermaid
sequenceDiagram
    participant U as User
    participant Bot as Bot
    participant Store as Store

    U->>Bot: /queue
    Bot->>Store: get(guildId)

    alt No session or empty queue
        Bot-->>U: "Queue is empty"
    else Has tracks
        Store-->>Bot: queueManager.getState()
        Bot->>Bot: Build Discord Embed
        Note over Bot: Track 1 (playing)<br/>Track 2<br/>Track 3<br/>...
        Bot-->>U: Embed message
    end
```

### /status Flow

```mermaid
sequenceDiagram
    participant U as User
    participant Bot as Bot
    participant API as API Client
    participant Socket as Socket Client
    participant Go as Go

    U->>Bot: /status
    Bot->>API: health()
    API->>Go: GET /health
    Go-->>API: {status: "ok"}
    Bot->>Socket: isConnected()
    Socket-->>Bot: true/false
    Bot->>Bot: Build status embed
    Note over Bot: Go API: healthy<br/>Socket: connected<br/>Guilds: 2 active
    Bot-->>U: Embed message
```

## 3. State Machine

### Guild Session States

```mermaid
stateDiagram-v2
    [*] --> Idle: Bot joins voice

    Idle --> Playing: /play (first track)
    Playing --> Paused: /pause
    Paused --> Playing: /resume
    Playing --> Playing: /skip (has next)
    Playing --> Playing: auto-advance
    Playing --> Idle: /skip (no next)
    Playing --> Idle: track finished (no next)

    Paused --> Idle: /stop
    Playing --> Idle: /stop
    Idle --> [*]: Bot leaves voice

    note right of Playing
        isPaused = false
        currentTrack != null
    end note

    note right of Paused
        isPaused = true
        currentTrack != null
    end note

    note right of Idle
        isPaused = false
        currentTrack = null
        queue may have tracks
    end note
```

## 4. Component Integration

```mermaid
flowchart TB
    subgraph Commands["Slash Commands"]
        PLAY[/play]
        STOP[/stop]
        PAUSE[/pause]
        RESUME[/resume]
        SKIP[/skip]
        QUEUE[/queue]
        NP[/nowplaying]
        PREV[/previous]
        STATUS[/status]
    end

    subgraph NewStore["New: Discord Session Store"]
        SESSIONS[Map guildId → GuildSession]
        GSESSION[GuildSession]
        QM[QueueManager instance]
    end

    subgraph Existing["Existing Components"]
        VOICE[c3-102 Voice Manager]
        API[c3-104 API Client]
        SOCKET[c3-105 Socket Client]
    end

    subgraph Go["Go API :8180"]
        HEALTH[GET /health]
        PLAY_EP[POST /session/:id/play]
        PAUSE_EP[POST /session/:id/pause]
        RESUME_EP[POST /session/:id/resume]
        STOP_EP[POST /session/:id/stop]
    end

    PLAY --> SESSIONS
    STOP --> SESSIONS
    PAUSE --> SESSIONS
    RESUME --> SESSIONS
    SKIP --> SESSIONS
    QUEUE --> SESSIONS
    NP --> SESSIONS
    PREV --> SESSIONS

    SESSIONS --> GSESSION
    GSESSION --> QM

    PLAY --> VOICE
    PLAY --> API
    PLAY --> SOCKET
    STOP --> VOICE
    STOP --> API
    PAUSE --> API
    RESUME --> API
    SKIP --> API
    SKIP --> SOCKET
    SKIP --> VOICE
    PREV --> API
    PREV --> SOCKET
    PREV --> VOICE
    STATUS --> API

    API --> HEALTH
    API --> PLAY_EP
    API --> PAUSE_EP
    API --> RESUME_EP
    API --> STOP_EP
```

## 5. Data Flow for Auto-Advance

```mermaid
flowchart LR
    subgraph Go["Go Audio Engine"]
        FFMPEG[FFmpeg]
        SOCKET_S[Socket Server]
    end

    subgraph Node["Node.js"]
        SOCKET_C[Socket Client]
        EVENT[Event Handler]
        STORE[Session Store]
        API[API Client]
        VOICE[Voice Manager]
    end

    FFMPEG -->|EOF| SOCKET_S
    SOCKET_S -->|event: finished| SOCKET_C
    SOCKET_C -->|emit 'event'| EVENT
    EVENT -->|queueManager.currentFinished| STORE
    STORE -->|nextTrack| EVENT
    EVENT -->|play nextTrack.url| API
    EVENT -->|new stream| VOICE
```

## 6. Queue Embed Layout

```
┌─────────────────────────────────────────┐
│  🎵 Queue (3 tracks)                    │
├─────────────────────────────────────────┤
│                                         │
│  ▶️ 1. Current Song Title               │
│     3:45 • Added by @user               │
│                                         │
│  2. Next Song Title                     │
│     4:20 • Added by @user               │
│                                         │
│  3. Another Song                        │
│     2:55 • Added by @user               │
│                                         │
├─────────────────────────────────────────┤
│  Total: 11:00 • 3 tracks                │
└─────────────────────────────────────────┘
```

## 7. Now Playing Embed Layout

```
┌─────────────────────────────────────────┐
│  🎵 Now Playing                         │
├─────────────────────────────────────────┤
│  ┌─────────┐                            │
│  │ thumb   │  Song Title                │
│  │  nail   │  Duration: 3:45            │
│  └─────────┘  Position: 1/5 in queue    │
│                                         │
│  ▶️ Playing | 🔊 Volume: 100%           │
├─────────────────────────────────────────┤
│  Next: Another Song Title               │
└─────────────────────────────────────────┘
```

## 8. Status Embed Layout

```
┌─────────────────────────────────────────┐
│  📊 Bot Status                          │
├─────────────────────────────────────────┤
│                                         │
│  Go API:     ✅ Healthy                 │
│  Socket:     ✅ Connected               │
│  Uptime:     2h 34m                     │
│                                         │
│  Active Sessions: 2                     │
│  Total Guilds: 5                        │
│                                         │
└─────────────────────────────────────────┘
```
