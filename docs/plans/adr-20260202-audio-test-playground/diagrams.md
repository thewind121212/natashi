# Audio Test Playground - Diagrams

## System Overview

```mermaid
flowchart TB
    subgraph Browser["Browser (localhost:3000)"]
        UI[Web UI]
        AUDIO[Audio Element]
    end

    subgraph NodeJS["Node.js Server"]
        EXPRESS[Express :3000]
        WS_SERVER[WebSocket Server]
        SOCKET_CLIENT[Unix Socket Client]
    end

    subgraph Go["Go Audio Server"]
        SOCKET_SERVER[Socket Server<br/>/tmp/music-playground.sock]
        HANDLER[Command Handler]
        SESSION[Session Manager]

        subgraph Encoder["Encoder Pipeline"]
            EXTRACT[YouTube Extractor<br/>yt-dlp]
            FFMPEG[FFmpeg Decoder]
            OPUS[Opus Encoder]
            FORMATTER{Format?}
            RAW[Raw Frames]
            WEBM[WebM Muxer]
        end
    end

    subgraph External["External"]
        YOUTUBE[YouTube]
    end

    UI <-->|WebSocket| WS_SERVER
    EXPRESS -->|Static files| UI
    WS_SERVER <--> SOCKET_CLIENT
    SOCKET_CLIENT <-->|Unix Socket| SOCKET_SERVER
    SOCKET_SERVER --> HANDLER
    HANDLER --> SESSION
    SESSION --> EXTRACT
    EXTRACT -->|URL| YOUTUBE
    YOUTUBE -->|Stream| FFMPEG
    FFMPEG --> OPUS
    OPUS --> FORMATTER
    FORMATTER -->|raw| RAW
    FORMATTER -->|webm| WEBM
    RAW --> SOCKET_SERVER
    WEBM --> SOCKET_SERVER
    AUDIO -->|plays| UI
```

## Command Flow - Play

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser
    participant N as Node.js
    participant G as Go Server
    participant Y as yt-dlp
    participant F as FFmpeg

    U->>B: Enter URL, click Play
    B->>N: WS: {action:"play", url, format:"webm"}
    N->>N: Generate session_id (UUID)
    N->>G: Socket: {"type":"play", session_id, url, format}

    G->>G: Create session
    G->>Y: Extract stream URL
    Note over Y: ~2-5 seconds
    Y-->>G: Direct audio URL

    G->>F: Start FFmpeg pipeline
    Note over F: ffmpeg -i <url> -c:a libopus -f webm pipe:1
    G-->>N: {"type":"ready", session_id, duration}
    N-->>B: WS: {event:"ready", duration}
    B->>B: Show "Playing..."

    loop Every ~100ms chunk
        F-->>G: WebM data chunk
        G-->>N: Binary data
        N-->>B: WS Binary
        B->>B: Append to buffer
    end

    B->>AUDIO: Play from Blob URL
    U->>U: Hears audio
```

## Command Flow - Stop

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser
    participant N as Node.js
    participant G as Go Server
    participant F as FFmpeg

    U->>B: Click Stop
    B->>N: WS: {action:"stop", session_id}
    N->>G: Socket: {"type":"stop", session_id}

    G->>F: Kill process (SIGTERM)
    G->>G: Cleanup session
    G-->>N: {"type":"finished", session_id}
    N-->>B: WS: {event:"stopped"}

    B->>B: Stop audio playback
    B->>B: Clear buffer
    B->>B: Show "Stopped"
```

## Audio Pipeline Detail

```mermaid
flowchart LR
    subgraph Input["Input (Variable)"]
        YT[YouTube Audio<br/>Various formats]
    end

    subgraph FFmpeg["FFmpeg Process"]
        DEC[Decoder<br/>Auto-detect codec]
        RESAMPLE[Resample<br/>→ 48000 Hz]
        CHANNELS[Channel Mix<br/>→ Stereo]
    end

    subgraph Opus["Opus Encoding"]
        ENC[libopus<br/>128 kbps VBR]
        FRAME[20ms frames<br/>960 samples]
    end

    subgraph Output["Output (Switchable)"]
        subgraph Raw["format=raw"]
            RAW_OUT[Raw Opus<br/>Discord-ready]
        end
        subgraph WebM["format=webm"]
            MUX[WebM Muxer]
            WEBM_OUT[WebM Stream<br/>Browser-ready]
        end
    end

    YT --> DEC --> RESAMPLE --> CHANNELS --> ENC --> FRAME
    FRAME --> RAW_OUT
    FRAME --> MUX --> WEBM_OUT
```

## FFmpeg Command

```mermaid
flowchart LR
    subgraph Command["FFmpeg Command"]
        direction TB
        A["-reconnect 1"]
        B["-reconnect_streamed 1"]
        C["-i <stream_url>"]
        D["-c:a libopus"]
        E["-b:a 128k"]
        F["-ar 48000"]
        G["-ac 2"]
        H["-f webm"]
        I["pipe:1"]
    end

    A --> B --> C --> D --> E --> F --> G --> H --> I
```

**Full command:**
```bash
ffmpeg \
  -reconnect 1 \
  -reconnect_streamed 1 \
  -reconnect_delay_max 5 \
  -i "$STREAM_URL" \
  -c:a libopus \
  -b:a 128k \
  -ar 48000 \
  -ac 2 \
  -f webm \
  -loglevel warning \
  pipe:1
```

## Session State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle: Session created
    Idle --> Extracting: play command
    Extracting --> Encoding: URL extracted
    Extracting --> Error: yt-dlp failed
    Encoding --> Streaming: FFmpeg started
    Encoding --> Error: FFmpeg failed
    Streaming --> Idle: stop command
    Streaming --> Idle: playback finished
    Streaming --> Error: stream error
    Error --> Idle: cleanup
    Idle --> [*]: session closed
```

## Component Interaction

```mermaid
flowchart TB
    subgraph NodeJS["Node.js Process"]
        N1[Express Server]
        N2[WebSocket Handler]
        N3[Socket Client]

        N1 -->|static files| N2
        N2 <-->|commands/events| N3
    end

    subgraph Go["Go Process"]
        G1[Socket Server]
        G2[Handler]
        G3[Session]
        G4[Encoder]

        G1 --> G2 --> G3 --> G4
        G4 -->|audio data| G1
    end

    N3 <-->|"/tmp/music-playground.sock"| G1
```

## Data Format - Raw Opus Frame

```
┌────────────────────────────────────────────────────────┐
│                    Raw Opus Frame                       │
├──────────────┬──────────────┬─────────────────────────┤
│  session_id  │   sequence   │       opus_data         │
│  (16 bytes)  │  (4 bytes)   │     (variable)          │
│    UUID      │  uint32 BE   │   20ms Opus frame       │
├──────────────┼──────────────┼─────────────────────────┤
│ 550e8400-... │  0x00000001  │  [encoded audio data]   │
└──────────────┴──────────────┴─────────────────────────┘

Total: 20 + variable (typically 100-300 bytes per frame)
Frames per second: 50 (20ms each)
```

## Browser Audio Flow

```mermaid
sequenceDiagram
    participant WS as WebSocket
    participant BUF as ArrayBuffer[]
    participant BLOB as Blob
    participant URL as Blob URL
    participant AUDIO as <audio>

    loop Receive chunks
        WS->>BUF: Push binary data
    end

    Note over BUF,BLOB: On "ready" event or buffer threshold
    BUF->>BLOB: new Blob(chunks, {type: 'audio/webm'})
    BLOB->>URL: URL.createObjectURL(blob)
    URL->>AUDIO: audio.src = blobUrl
    AUDIO->>AUDIO: audio.play()
```

## Error Handling Flow

```mermaid
flowchart TB
    subgraph Errors["Error Types"]
        E1[Invalid URL]
        E2[yt-dlp Failed]
        E3[FFmpeg Failed]
        E4[Socket Disconnected]
    end

    subgraph Handling["Error Handling"]
        H1[Return error event]
        H2[Cleanup session]
        H3[Log error]
        H4[Notify browser]
    end

    subgraph UI["Browser Response"]
        U1[Show error message]
        U2[Reset UI state]
        U3[Enable Play button]
    end

    E1 --> H1
    E2 --> H1
    E3 --> H1
    E4 --> H2

    H1 --> H2 --> H3 --> H4 --> U1 --> U2 --> U3
```

## Network Topology

```mermaid
flowchart LR
    subgraph Local["localhost"]
        BROWSER[Browser<br/>:3000]
        NODE[Node.js<br/>Express :3000<br/>WS :3000]
        GO[Go Server<br/>Unix Socket]
    end

    subgraph Internet["Internet"]
        YOUTUBE[YouTube<br/>CDN]
    end

    BROWSER <-->|HTTP + WS| NODE
    NODE <-->|Unix Socket| GO
    GO -->|HTTPS| YOUTUBE
```
