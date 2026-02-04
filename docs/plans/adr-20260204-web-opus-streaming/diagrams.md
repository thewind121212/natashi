# Web Opus Streaming - Diagrams

## Task Modes Overview

```mermaid
flowchart TB
    subgraph Tasks["Taskfile Commands"]
        DEBUG["task run:debug<br/>DEBUG_AUDIO=1"]
        WEB["task run:web<br/>WEB_AUDIO=1"]
        BOT["task run:bot<br/>(no env)"]
    end

    subgraph Formats["Audio Format"]
        PCM["PCM s16le"]
        OPUS256["Opus 256kbps"]
        OPUS128["Opus 128kbps"]
    end

    subgraph Output["Audio Output"]
        FFPLAY["ffplay → MacBook"]
        BROWSER["WebSocket → Browser"]
        DISCORD["Discord Voice"]
    end

    DEBUG --> PCM --> FFPLAY
    WEB --> OPUS256 --> BROWSER
    BOT --> OPUS128 --> DISCORD

    style WEB fill:#ff9
    style OPUS256 fill:#ff9
    style BROWSER fill:#ff9
```

## System Context - Web Mode

```mermaid
flowchart TB
    subgraph External["External"]
        YOUTUBE[YouTube]
        USER[User Browser]
    end

    subgraph System["Music Bot System"]
        subgraph Go["Go Audio Server :8180"]
            YTDLP[yt-dlp]
            FFMPEG[FFmpeg]
        end

        subgraph Node["Node.js :3000"]
            WS[WebSocket Server]
        end
    end

    USER -->|"1. play(url)"| WS
    WS -->|"2. POST format:web"| Go
    Go -->|"3. Extract URL"| YOUTUBE
    YOUTUBE -->|"4. Audio stream"| YTDLP
    YTDLP --> FFMPEG
    FFMPEG -->|"5. Opus 256kbps"| WS
    WS -->|"6. Binary WebSocket"| USER

    style USER fill:#f9f,stroke:#333
    style Go fill:#9ff,stroke:#333
    style Node fill:#ff9,stroke:#333
```

## Audio Pipeline Comparison

### Debug Mode (`task run:debug`)

```mermaid
flowchart LR
    subgraph Go["Go"]
        YT1[yt-dlp] --> FF1[FFmpeg]
        FF1 -->|PCM s16le| SOCK1[Socket]
    end

    subgraph Node["Node.js<br/>DEBUG_AUDIO=1"]
        SOCK1 --> FFPLAY[ffplay]
        FFPLAY --> SPEAKER[MacBook Speaker]
    end

    subgraph Browser["Browser"]
        WS1[WebSocket]
        WS1 -.->|progress only| UI1[UI]
    end

    style SPEAKER fill:#9f9
```

### Web Mode (`task run:web`) - NEW

```mermaid
flowchart LR
    subgraph Go["Go"]
        YT2[yt-dlp] --> FF2[FFmpeg]
        FF2 -->|Opus 256kbps| SOCK2[Socket]
    end

    subgraph Node["Node.js<br/>WEB_AUDIO=1"]
        SOCK2 --> WS2[WebSocket Server]
    end

    subgraph Browser["Browser"]
        WS2 -->|binary| DECODER[opus-decoder]
        DECODER -->|PCM| WEBAUDIO[Web Audio API]
        WEBAUDIO --> SPEAKER2[Browser Speaker]
    end

    style SPEAKER2 fill:#9f9
    style Node fill:#ff9
```

### Bot Mode (`task run:bot`)

```mermaid
flowchart LR
    subgraph Go["Go"]
        YT3[yt-dlp] --> FF3[FFmpeg]
        FF3 -->|Opus 128kbps| SOCK3[Socket]
    end

    subgraph Node["Node.js"]
        SOCK3 --> VOICE[Voice Manager]
        VOICE --> DISCORD[Discord Voice UDP]
    end

    style DISCORD fill:#9f9
```

## Sequence Diagram - Web Mode Startup

```mermaid
sequenceDiagram
    participant User
    participant Task as Taskfile
    participant Go as Go Server
    participant Node as Node.js
    participant Browser

    User->>Task: task run:web
    Task->>Go: Start (port 8180)
    Task->>Node: WEB_AUDIO=1 npm run dev

    Note over Node: webMode = true

    Browser->>Node: WebSocket connect
    Node-->>Browser: {type: "state", webMode: true}

    Note over Browser: Initialize opus-decoder
```

## Sequence Diagram - Web Mode Playback

```mermaid
sequenceDiagram
    participant U as User
    participant UI as React UI
    participant WS as WebSocket (Node.js)
    participant API as Gin API (Go)
    participant FF as FFmpeg

    U->>UI: Click Play
    UI->>WS: {action: "play", url}

    Note over WS: webMode=true → format="web"

    WS->>API: POST /session/:id/play {format: "web"}
    API->>FF: Start Opus 256kbps encoding

    loop Every 20ms frame
        FF-->>API: Opus frame
        API-->>WS: Binary via socket
        WS-->>UI: ArrayBuffer via WebSocket
        UI->>UI: opus-decoder → PCM
        UI->>UI: Web Audio API → play
    end

    FF-->>API: EOF
    API-->>WS: {type: "finished"}
    WS-->>UI: {type: "finished"}
```

## Component Integration

```mermaid
flowchart TB
    subgraph C3_2["C3-2: Go Audio (c3-204)"]
        FORMAT{Format?}
        PCM[PCM s16le]
        OPUS128[Opus 128kbps]
        OPUS256[Opus 256kbps]

        FORMAT -->|pcm| PCM
        FORMAT -->|opus| OPUS128
        FORMAT -->|web| OPUS256
    end

    subgraph C3_1["C3-1: Node.js (c3-107)"]
        ENV{Env Var?}
        FFPLAY2[ffplay]
        BINARY[broadcastBinary]
        VOICE2[Voice Manager]

        ENV -->|DEBUG_AUDIO| FFPLAY2
        ENV -->|WEB_AUDIO| BINARY
        ENV -->|none| VOICE2
    end

    subgraph Playground["Browser"]
        OPUSDEC[opus-decoder]
        WEBAUD[Web Audio API]

        OPUSDEC --> WEBAUD
    end

    PCM --> FFPLAY2
    OPUS256 --> BINARY --> OPUSDEC
    OPUS128 --> VOICE2

    style OPUS256 fill:#ff9
    style BINARY fill:#ff9
    style OPUSDEC fill:#ff9
```

## State Machine - Node.js Mode Selection

```mermaid
stateDiagram-v2
    [*] --> CheckEnv: Startup

    state CheckEnv {
        [*] --> WEB_AUDIO: WEB_AUDIO=1
        [*] --> DEBUG_AUDIO: DEBUG_AUDIO=1
        [*] --> BOT: neither set
    }

    WEB_AUDIO --> WebMode: webMode=true
    DEBUG_AUDIO --> DebugMode: debugMode=true
    BOT --> BotMode: both false

    state WebMode {
        format = "web"
        audio → broadcastBinary
    }

    state DebugMode {
        format = "pcm"
        audio → ffplay
    }

    state BotMode {
        format = "opus"
        audio → Discord
    }
```

## Data Flow - Binary WebSocket

```mermaid
flowchart LR
    subgraph Go
        FRAME[Opus Frame<br/>~500 bytes]
        HEADER[4-byte length<br/>big-endian]
        HEADER --> FRAME
    end

    subgraph Node
        RECV[Socket receives]
        PARSE[Parse header + data]
        SEND[ws.send binary]
        RECV --> PARSE --> SEND
    end

    subgraph Browser
        ONMSG[onmessage]
        CHECK{ArrayBuffer?}
        DECODE[opus-decoder]
        AUDIO[Web Audio API]

        ONMSG --> CHECK
        CHECK -->|yes| DECODE
        CHECK -->|no| JSON[JSON.parse]
        DECODE --> AUDIO
    end

    FRAME --> RECV
    SEND --> ONMSG
```

## Class Diagram - Browser Audio

```mermaid
classDiagram
    class useAudioPlayer {
        -audioContext: AudioContext
        -decoder: Decoder
        -nextPlayTime: number
        -playedSeconds: number
        +init() Promise
        +playChunk(data: Uint8Array) void
        +reset() void
    }

    class useWebSocket {
        -ws: WebSocket
        -webMode: boolean
        -audioPlayer: useAudioPlayer
        +play(url) void
        +stop() void
        +pause() void
        +resume() void
    }

    useWebSocket --> useAudioPlayer: uses (if webMode)
```

## FFmpeg Args Comparison

```mermaid
flowchart TB
    subgraph Input["Common Input"]
        IN["-i pipe:0<br/>-f s16le<br/>-ar 48000<br/>-ac 2"]
    end

    subgraph PCM["Format: PCM<br/>(run:debug)"]
        PCM_OUT["-f s16le<br/>-ar 48000<br/>-ac 2<br/>pipe:1"]
    end

    subgraph Opus128["Format: Opus<br/>(run:bot)"]
        OPUS128_OUT["-c:a libopus<br/>-b:a 128000<br/>-vbr on<br/>-frame_duration 20<br/>-f opus<br/>pipe:1"]
    end

    subgraph Opus256["Format: Web<br/>(run:web) NEW"]
        OPUS256_OUT["-c:a libopus<br/>-b:a 256000<br/>-vbr on<br/>-compression_level 10<br/>-frame_duration 20<br/>-application audio<br/>-f opus<br/>pipe:1"]
    end

    IN --> PCM_OUT
    IN --> OPUS128_OUT
    IN --> OPUS256_OUT

    style Opus256 fill:#ff9
```

## Error Handling Flow

```mermaid
flowchart TB
    START[Binary message received]
    CHECK1{ArrayBuffer?}
    CHECK2{webMode?}
    CHECK3{Decoder ready?}
    CHECK4{Decode success?}
    PLAY[Schedule playback]
    ERR1[Parse as JSON]
    ERR2[Ignore - not in web mode]
    ERR3[Init decoder first]
    ERR4[Log error, skip frame]

    START --> CHECK1
    CHECK1 -->|yes| CHECK2
    CHECK1 -->|no| ERR1
    CHECK2 -->|yes| CHECK3
    CHECK2 -->|no| ERR2
    CHECK3 -->|yes| CHECK4
    CHECK3 -->|no| ERR3
    CHECK4 -->|yes| PLAY
    CHECK4 -->|no| ERR4
```

## Taskfile Structure

```mermaid
flowchart TB
    subgraph Taskfile["Taskfile.yml"]
        DEFAULT[default]
        DEBUG[run:debug]
        WEB[run:web]
        BOT[run:bot]
        KILL[kill]
        BUILD[build]
    end

    DEBUG -->|"DEBUG_AUDIO=1"| GO1[Go + Node + Vite]
    WEB -->|"WEB_AUDIO=1"| GO2[Go + Node + Vite]
    BOT -->|"(no env)"| GO3[Go + Node]

    style WEB fill:#ff9
```
