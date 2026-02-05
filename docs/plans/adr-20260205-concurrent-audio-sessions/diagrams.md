# Concurrent Audio Sessions - Diagrams

## Current Flow (Single Session)

```mermaid
sequenceDiagram
    participant U1 as Guild A
    participant U2 as Guild B
    participant Node as Node.js
    participant Go as Go Audio

    U1->>Node: play(url)
    Node->>Go: POST /session/guildA/play
    Go-->>Go: stopAllSessions()
    Go-->>Node: Audio [len][data]
    Note over U1: Playing...

    U2->>Node: play(url)
    Node->>Go: POST /session/guildB/play
    Go-->>Go: stopAllSessions()
    Note over U1: STOPPED!
    Go-->>Node: Audio [len][data]
    Note over U2: Now Guild B playing
```

## New Flow (Concurrent Sessions)

```mermaid
sequenceDiagram
    participant U1 as Guild A
    participant U2 as Guild B
    participant Node as Node.js
    participant Go as Go Audio

    U1->>Node: play(url)
    Node->>Go: POST /session/guildA/play
    Go-->>Go: sessions["guildA"] = new
    Go-->>Node: Audio [len][guildA][data]
    Note over U1: Playing...

    U2->>Node: play(url)
    Node->>Go: POST /session/guildB/play
    Go-->>Go: sessions["guildB"] = new
    Go-->>Node: Audio [len][guildB][data]
    Note over U1,U2: Both playing!

    Node-->>Node: Route by sessionId
    Node-->>U1: Audio for Guild A
    Node-->>U2: Audio for Guild B
```

## Component Integration

```mermaid
flowchart TB
    subgraph Modified["Modified Components"]
        c3_202[c3-202<br/>Session Manager<br/>Remove stop-all<br/>Add session ID to packet]
        c3_105[c3-105<br/>Socket Client<br/>Parse session ID<br/>Route by ID]
    end

    subgraph Unchanged["Unchanged"]
        c3_201[c3-201 Gin API]
        c3_203[c3-203 Stream Extractor]
        c3_204[c3-204 Opus Encoder]
        c3_206[c3-206 Socket Server]
        c3_107[c3-107 WebSocket Handler]
    end

    c3_201 -->|StartPlayback| c3_202
    c3_202 -->|ExtractStreamURL| c3_203
    c3_203 -->|streamUrl| c3_204
    c3_204 -->|audio| c3_202
    c3_202 -->|packet with sessionId| c3_206
    c3_206 -->|Unix Socket| c3_105
    c3_105 -->|audio event + sessionId| c3_107
```

## Packet Format Change

### Current Format
```
┌────────────────────────────┬────────────────────────────┐
│    Length (4 bytes)        │      Audio Data            │
│    Big-endian uint32       │      Variable length       │
│    = audio_length          │                            │
└────────────────────────────┴────────────────────────────┘
```

### New Format
```
┌────────────────────────────┬────────────────────────────┬────────────────────────────┐
│    Length (4 bytes)        │    Session ID (24 bytes)   │      Audio Data            │
│    Big-endian uint32       │    Padded snowflake        │      Variable length       │
│    = 24 + audio_length     │    "1234567890123456789   "│                            │
└────────────────────────────┴────────────────────────────┴────────────────────────────┘
```

## Session State Machine (Unchanged)

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Extracting: play
    Extracting --> Streaming: ready
    Extracting --> Error: extraction failed
    Streaming --> Paused: pause
    Paused --> Streaming: resume
    Streaming --> Stopped: stop / finished
    Paused --> Stopped: stop
    Error --> [*]
    Stopped --> [*]
```

## Go Session Manager - Before/After

### Before: Stop All Sessions
```mermaid
flowchart TB
    START[StartPlayback called]
    STOP_ALL[Stop ALL existing sessions]
    CREATE[Create new session]
    RUN[Run playback goroutine]

    START --> STOP_ALL --> CREATE --> RUN
```

### After: Stop Only Same Session
```mermaid
flowchart TB
    START[StartPlayback called]
    CHECK{Session with<br/>same ID exists?}
    STOP_ONE[Stop only that session]
    CREATE[Create new session]
    RUN[Run playback goroutine]
    KEEP[Keep other sessions running]

    START --> CHECK
    CHECK -->|Yes| STOP_ONE --> CREATE
    CHECK -->|No| CREATE
    CREATE --> RUN
    STOP_ONE --> KEEP
```

## Node.js Audio Routing - Before/After

### Before: Loop Through Sessions
```mermaid
flowchart TB
    RECV[Receive audio packet]
    LOOP[Loop through all sessions]
    MATCH{Find session with<br/>currentSessionId set?}
    ROUTE[Route to that session]
    DROP[Drop packet]

    RECV --> LOOP --> MATCH
    MATCH -->|Found| ROUTE
    MATCH -->|Not found| DROP
```

### After: Direct Lookup by Session ID
```mermaid
flowchart TB
    RECV[Receive audio packet]
    PARSE[Parse session ID from packet header]
    LOOKUP[Direct lookup: sessionStore.findBySessionId]
    FOUND{Session found?}
    ROUTE[Route to session]
    DROP[Drop packet - stale]

    RECV --> PARSE --> LOOKUP --> FOUND
    FOUND -->|Yes| ROUTE
    FOUND -->|No| DROP
```

## Concurrent Sessions Memory Model

```mermaid
flowchart TB
    subgraph Go["Go Process"]
        SM[Session Manager]
        subgraph Sessions["Concurrent Sessions"]
            S1[Session: guildA<br/>FFmpeg: ~100MB]
            S2[Session: guildB<br/>FFmpeg: ~100MB]
            S3[Session: userC<br/>FFmpeg: ~100MB]
        end
    end

    subgraph Socket["Unix Socket"]
        BUF[Shared Buffer<br/>All sessions multiplex]
    end

    subgraph Node["Node.js Process"]
        SC[Socket Client]
        subgraph UserSessions["User Sessions"]
            US1[Session: guildA]
            US2[Session: guildB]
            US3[Session: userC]
        end
    end

    SM --> S1 & S2 & S3
    S1 & S2 & S3 -->|Audio packets with ID| BUF
    BUF --> SC
    SC -->|Route by ID| US1 & US2 & US3
```
