# Story: Stream High-Quality Opus to Web Browser

## Title

Add `task:web` mode to stream high-quality Opus audio to web browser via WebSocket

## C3 Components Affected

```mermaid
flowchart LR
    subgraph Affected["Affected Components"]
        c3_204[c3-204 Opus Encoder<br/>Add web format]
        c3_107[c3-107 WebSocket Handler<br/>Binary streaming]
        PLAYGROUND[Playground React UI<br/>Web Audio API]
    end

    subgraph Unchanged["Unchanged"]
        c3_201[c3-201 Gin API]
        c3_202[c3-202 Session Manager]
        c3_203[c3-203 Stream Extractor]
        c3_206[c3-206 Socket Server]
        c3_105[c3-105 Socket Client]
    end
```

| Component | Layer | Change Type |
|-----------|-------|-------------|
| c3-204 Opus Encoder | Go | Modify (add high-bitrate web format) |
| c3-107 WebSocket Handler | Node.js | Modify (forward Opus binary to browser) |
| Playground UI | React | Modify (add Web Audio API + Opus decoder) |

## User Intent

- **User**: Developer/User playing music via web browser
- **Goal**: Stream YouTube Premium quality audio to web browser in real-time
- **Why**: Enable browser-based playback without MacBook speaker dependency, maintaining highest audio quality

## Current Flow (No Browser Playback)

```mermaid
sequenceDiagram
    participant Browser
    participant Node as Node.js
    participant Go as Go (FFmpeg)

    Browser->>Node: play(url, "pcm")
    Node->>Go: POST /session/:id/play {format: "pcm"}
    Go-->>Node: PCM chunks
    Node->>Node: ffplay (MacBook speaker)
    Note over Browser: Browser only sees progress<br/>Cannot hear audio
```

**Problem:** Browser cannot play audio - only MacBook speakers work via ffplay

## Proposed Solution

```mermaid
sequenceDiagram
    participant Browser
    participant Node as Node.js
    participant Go as Go (FFmpeg)

    Browser->>Node: play(url, "web")
    Node->>Go: POST /session/:id/play {format: "web"}
    Go->>Go: FFmpeg Opus 256kbps (high quality)

    loop Real-time streaming
        Go-->>Node: Opus chunks via socket
        Node-->>Browser: WebSocket binary
        Browser->>Browser: opus-decoder WASM
        Browser->>Browser: Web Audio API playback
    end
```

**Architecture:**
```mermaid
flowchart LR
    subgraph Go["Go (Processing Unit)"]
        YTDLP[yt-dlp] -->|stream URL| FFMPEG[FFmpeg]
        FFMPEG -->|Opus 256kbps| SOCKET[Unix Socket]
    end

    subgraph Node["Node.js (Transfer Unit)"]
        SOCKET -->|Opus chunks| WS[WebSocket Server]
    end

    subgraph Browser["Browser (Playback Unit)"]
        WS -->|binary| DECODER[opus-decoder WASM]
        DECODER -->|PCM| WEBAUDIO[Web Audio API]
        WEBAUDIO --> SPEAKER[Browser Speaker]
    end
```

## Repo Evidence

| File | Line | Evidence |
|------|------|----------|
| `internal/encoder/ffmpeg.go` | 151-161 | Opus format exists (128kbps for Discord) |
| `internal/encoder/types.go` | - | Format enum (FormatPCM, FormatOpus) |
| `app/src/websocket.ts` | 177 | Format hardcoded to "pcm" |
| `playground/src/App.tsx` | - | React UI exists |
| `playground/src/hooks/useWebSocket.ts` | - | WebSocket hook exists |

## Detailed Design

### 1. Go: Add Web Format (c3-204)

```go
// internal/encoder/types.go
const (
    FormatPCM  Format = "pcm"
    FormatOpus Format = "opus"  // Discord: 128kbps
    FormatWeb  Format = "web"   // Browser: 256kbps high quality
)

// internal/encoder/ffmpeg.go
case FormatWeb:
    // High-quality Opus for web browser
    args = append(args,
        "-c:a", "libopus",
        "-b:a", "256000",           // 256kbps (YouTube Premium quality)
        "-vbr", "on",
        "-compression_level", "10",
        "-frame_duration", "20",
        "-application", "audio",
        "-f", "opus",
        "pipe:1",
    )
```

### 2. Node.js: Forward Opus to Browser (c3-107)

```typescript
// app/src/websocket.ts

// New mode flag
private playbackMode: 'debug' | 'web' = 'debug';

// Handle format selection from browser
if (message.action === 'play') {
    const format = message.mode === 'web' ? 'web' : 'pcm';
    this.playbackMode = message.mode || 'debug';
    await this.apiClient.play(sessionId, url, format);
}

// Forward audio based on mode
this.socketClient.on('audio', (data: Buffer) => {
    if (this.playbackMode === 'web') {
        // Send binary Opus to browser
        this.broadcastBinary(data);
    } else {
        // PCM to ffplay (existing flow)
        this.pcmPlayer.write(data);
    }
});

private broadcastBinary(data: Buffer): void {
    for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: true });
        }
    }
}
```

### 3. Browser: Opus Decoder + Web Audio API with Progress Tracking

```typescript
// playground/src/hooks/useAudioPlayer.ts
import { Decoder } from 'opus-decoder';

interface UseAudioPlayerOptions {
    onProgress?: (seconds: number) => void;
}

export function useAudioPlayer({ onProgress }: UseAudioPlayerOptions = {}) {
    const audioContext = useRef<AudioContext>();
    const decoder = useRef<Decoder>();
    const nextPlayTime = useRef(0);
    const playedSeconds = useRef(0);  // Track playback position for progress bar

    const init = async () => {
        audioContext.current = new AudioContext({ sampleRate: 48000 });
        decoder.current = new Decoder({ sampleRate: 48000, channels: 2 });
        await decoder.current.ready;
        playedSeconds.current = 0;
    };

    const playChunk = (opusData: Uint8Array) => {
        const { channelData, samplesDecoded } = decoder.current.decode(opusData);

        if (samplesDecoded > 0) {
            const buffer = audioContext.current.createBuffer(2, samplesDecoded, 48000);
            buffer.copyToChannel(channelData[0], 0);
            buffer.copyToChannel(channelData[1], 1);

            const source = audioContext.current.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.current.destination);

            // Schedule playback
            const now = audioContext.current.currentTime;
            if (nextPlayTime.current < now) {
                nextPlayTime.current = now;
            }
            source.start(nextPlayTime.current);
            nextPlayTime.current += samplesDecoded / 48000;

            // Update progress tracking (accurate based on samples decoded)
            playedSeconds.current += samplesDecoded / 48000;
            onProgress?.(playedSeconds.current);
        }
    };

    const getPlaybackSeconds = () => playedSeconds.current;

    const reset = () => {
        playedSeconds.current = 0;
        nextPlayTime.current = 0;
    };

    return { init, playChunk, getPlaybackSeconds, reset };
}
```

### 4. Browser: WebSocket Binary Handler

```typescript
// playground/src/hooks/useWebSocket.ts

// Handle binary messages (Opus audio)
ws.binaryType = 'arraybuffer';

ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
        // Binary Opus data
        const opusData = new Uint8Array(event.data);
        audioPlayer.playChunk(opusData);
    } else {
        // JSON control message
        const message = JSON.parse(event.data);
        handleControlMessage(message);
    }
};
```

### 5. UI: Mode Toggle

```tsx
// playground/src/components/ModeToggle.tsx
export function ModeToggle({ mode, onModeChange }) {
    return (
        <div className="flex gap-2">
            <Button
                variant={mode === 'debug' ? 'default' : 'ghost'}
                onClick={() => onModeChange('debug')}
            >
                MacBook Speaker
            </Button>
            <Button
                variant={mode === 'web' ? 'default' : 'ghost'}
                onClick={() => onModeChange('web')}
            >
                Browser Speaker
            </Button>
        </div>
    );
}
```

## Alternatives Considered

1. **MediaSource Extensions (MSE)** - Requires WebM container framing, more complex
2. **WebRTC** - Overkill for single-client streaming
3. **HLS/DASH** - High latency, requires segment files (user explicitly rejected)
4. **PCM over WebSocket** - Large bandwidth, browser can't play raw PCM natively

## Acceptance Criteria

- [ ] New `web` format available in Go API
- [ ] Browser can play audio through its own speakers
- [ ] Audio quality is 256kbps Opus (YouTube Premium quality)
- [ ] Progress bar works correctly (tracks playedSeconds from decoded samples)
- [ ] Pause/Resume works in browser mode
- [ ] Skip/Previous works in browser mode
- [ ] Mode toggle in UI (debug vs web)
- [ ] Progress resets correctly on track change
- [ ] No regression in debug mode (MacBook speaker)
- [ ] No regression in Discord bot (Opus 128kbps)

## Implementation Plan

### Go Tasks

- **G1**: Add `FormatWeb` constant in `internal/encoder/types.go`
- **G2**: Add web format FFmpeg args in `internal/encoder/ffmpeg.go` (256kbps Opus)

### Node.js Tasks

- **N1**: Add playback mode tracking in `websocket.ts`
- **N2**: Add `broadcastBinary()` method for Opus streaming
- **N3**: Route audio to browser or ffplay based on mode
- **N4**: Handle mode in play action

### Browser Tasks

- **B1**: Add `opus-decoder` dependency (`npm install opus-decoder`)
- **B2**: Create `useAudioPlayer` hook with Web Audio API + progress tracking
- **B3**: Update `useWebSocket` to handle binary messages
- **B4**: Add mode toggle component
- **B5**: Wire up audio player to WebSocket
- **B6**: Connect progress callback to UI state for progress bar

### Integration Tasks

- **I1**: Test full flow: browser play → Opus stream → browser audio
- **I2**: Test mode switching between debug and web

## Testing Plan

**Manual QA - Web Mode:**
1. Run `task run:debug` (or new `task run:web`)
2. Open http://localhost:5173
3. Select "Browser Speaker" mode
4. Play a YouTube video
5. Verify:
   - Audio plays through browser speakers (not MacBook)
   - Quality sounds good (256kbps)
   - Progress bar works
   - Pause/Resume works
   - Skip works

**Verify no regression:**
1. Switch to "MacBook Speaker" mode
2. Verify PCM playback still works
3. Run Discord bot, verify Opus 128kbps still works

## Dependencies

- `opus-decoder` npm package (WASM-based Opus decoder)
- Story: "Remove -re flag for PCM" should be completed first (shared PCM progress tracking patterns)

## Risks & Open Questions

**Risks:**
- Browser AudioContext requires user interaction to start (mitigate: init on first play click)
- opus-decoder WASM size (~300KB) (acceptable)
- Scheduling accuracy in Web Audio API (mitigate: use nextPlayTime pattern)

**Open Questions:**
- None remaining

## Out of Scope

- Mobile browser support
- Multiple simultaneous browser clients
- Volume control in browser
- Visualizations / waveform
