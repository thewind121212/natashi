# Discord Bot /play and /stop Diagrams

## System Context

```mermaid
flowchart TB
    subgraph External["External Systems"]
        DISCORD[Discord API]
        YOUTUBE[YouTube]
    end

    subgraph System["Music Bot System"]
        subgraph NodeBot["Node.js Discord Bot (NEW)"]
            BOT[c3-101<br/>Discord Bot]
            VM[c3-102<br/>Voice Manager]
            API_C[c3-104<br/>API Client]
            SOCK_C[c3-105<br/>Socket Client]
        end

        subgraph Go["Go Audio Server (unchanged)"]
            API[c3-201 Gin API]
            SESSION[c3-202 Session]
            EXTRACT[c3-203 Extractor]
            ENCODE[c3-204 Encoder]
            SOCKET[c3-206 Socket]
        end
    end

    DISCORD <-->|Gateway + Voice| BOT
    BOT --> VM
    VM --> SOCK_C
    BOT --> API_C
    API_C -->|HTTP :8180| API
    SOCK_C <-->|Unix Socket| SOCKET
    API --> SESSION --> EXTRACT -->|yt-dlp| YOUTUBE
    EXTRACT --> ENCODE --> SOCKET
```

## /play Command Flow

```mermaid
sequenceDiagram
    participant U as User
    participant DC as Discord
    participant BOT as Discord Bot
    participant VM as Voice Manager
    participant API as API Client
    participant SOCK as Socket Client
    participant GO as Go Server

    U->>DC: /play <url>
    DC->>BOT: Interaction

    Note over BOT: Validate user in voice channel
    alt Not in voice
        BOT-->>DC: "Join a voice channel first"
        DC-->>U: Error message
    end

    Note over BOT: Check if already playing
    alt Already playing
        BOT->>API: stop(currentSession)
        API->>GO: POST /session/:id/stop
        BOT->>VM: stop()
    end

    BOT->>VM: join(voiceChannel)
    VM->>DC: Join voice channel
    DC-->>VM: Connected

    BOT->>API: play(sessionId, url, "opus")
    API->>GO: POST /session/:id/play
    GO-->>API: {status: "playing"}

    BOT-->>DC: "Now playing: <url>"
    DC-->>U: Success message

    loop Audio Streaming
        GO-->>SOCK: OGG/Opus chunks
        SOCK-->>VM: AudioResource
        VM-->>DC: Voice UDP
        DC-->>U: Audio in voice channel
    end
```

## /stop Command Flow

```mermaid
sequenceDiagram
    participant U as User
    participant DC as Discord
    participant BOT as Discord Bot
    participant VM as Voice Manager
    participant API as API Client
    participant GO as Go Server

    U->>DC: /stop
    DC->>BOT: Interaction

    Note over BOT: Check if playing
    alt Not playing
        BOT-->>DC: "Nothing is playing"
        DC-->>U: Error message
    end

    BOT->>API: stop(sessionId)
    API->>GO: POST /session/:id/stop
    GO-->>API: {status: "stopped"}

    BOT->>VM: disconnect()
    VM->>DC: Leave voice channel

    BOT-->>DC: "Playback stopped"
    DC-->>U: Success message
```

## Component Architecture

```mermaid
flowchart TB
    subgraph NodeBot["node/src/"]
        subgraph Commands["commands/"]
            PLAY[play.ts]
            STOP[stop.ts]
        end

        subgraph Voice["voice/"]
            MANAGER[manager.ts<br/>c3-102]
        end

        subgraph Audio["audio/"]
            API_CLIENT[api-client.ts<br/>c3-104]
            SOCKET_CLIENT[socket-client.ts<br/>c3-105]
            BRIDGE[stream-bridge.ts]
        end

        INDEX[index.ts]
        CONFIG[config.ts]
    end

    INDEX --> Commands
    INDEX --> MANAGER
    PLAY --> MANAGER
    PLAY --> API_CLIENT
    STOP --> MANAGER
    STOP --> API_CLIENT
    MANAGER --> SOCKET_CLIENT
    MANAGER --> BRIDGE
    SOCKET_CLIENT --> BRIDGE
```

## Audio Pipeline

```mermaid
flowchart LR
    subgraph Go["Go Audio Server"]
        YT[yt-dlp] --> FF[FFmpeg]
        FF --> OPUS[Opus Encoder]
        OPUS --> OGG[OGG Container]
        OGG --> SOCK[Unix Socket]
    end

    subgraph Node["Node.js Bot"]
        RECV[Socket Client] --> DEMUX[OGG Demux<br/>discord.js]
        DEMUX --> RES[AudioResource]
        RES --> PLAYER[AudioPlayer]
    end

    subgraph Discord["Discord"]
        VOICE[Voice Connection]
        UDP[Voice UDP]
    end

    SOCK -->|OGG/Opus| RECV
    PLAYER --> VOICE
    VOICE --> UDP
```

## Voice Manager State

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Joining: join(channel)
    Joining --> Connected: connection ready
    Joining --> Idle: connection failed

    Connected --> Playing: play(resource)
    Playing --> Connected: track ended
    Playing --> Playing: play(new resource)
    Playing --> Stopping: stop()

    Stopping --> Connected: stopped
    Connected --> Disconnecting: disconnect()
    Disconnecting --> Idle: disconnected

    Playing --> Disconnecting: disconnect()
```

## Error Handling

```mermaid
flowchart TB
    subgraph Errors["Error Scenarios"]
        E1[User not in voice]
        E2[Invalid URL]
        E3[Go server down]
        E4[Voice connection failed]
        E5[Stream interrupted]
    end

    subgraph Responses["User Feedback"]
        R1["'Join a voice channel first'"]
        R2["'Invalid YouTube URL'"]
        R3["'Audio server unavailable'"]
        R4["'Failed to join voice channel'"]
        R5["'Playback interrupted'"]
    end

    E1 --> R1
    E2 --> R2
    E3 --> R3
    E4 --> R4
    E5 --> R5
```

## File Dependencies

```mermaid
flowchart TB
    subgraph Entry["Entry"]
        INDEX[index.ts]
    end

    subgraph Config["Config"]
        CFG[config.ts]
        ENV[.env]
    end

    subgraph Commands["Commands"]
        CMD_IDX[commands/index.ts]
        PLAY[commands/play.ts]
        STOP[commands/stop.ts]
    end

    subgraph Voice["Voice"]
        VM[voice/manager.ts]
    end

    subgraph Audio["Audio"]
        API[audio/api-client.ts]
        SOCK[audio/socket-client.ts]
        BRIDGE[audio/stream-bridge.ts]
    end

    ENV --> CFG
    CFG --> INDEX
    INDEX --> CMD_IDX
    CMD_IDX --> PLAY
    CMD_IDX --> STOP
    PLAY --> VM
    PLAY --> API
    STOP --> VM
    STOP --> API
    VM --> SOCK
    VM --> BRIDGE
    SOCK --> BRIDGE
```
