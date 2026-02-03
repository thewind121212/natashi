# Plan: Gin HTTP Control Server for Audio Streaming

## Problem

Current architecture has a **blocking command loop**:
- `handlePlay()` blocks in `streamAudio()` until stream ends
- Stop command sent via Unix socket never gets processed
- Pause/resume work because they're Node.js only (don't need Go)

## Solution

Separate control plane from data plane:

```
BEFORE (broken):
┌─────────┐     Unix Socket      ┌─────────┐
│ Node.js │ ←──── commands ────→ │   Go    │  ← BLOCKED
│         │ ←──── audio ───────  │         │
└─────────┘                      └─────────┘

AFTER (fixed):
┌─────────┐     HTTP :8180       ┌─────────┐
│ Node.js │ ────── control ────→ │ Gin API │  ← Non-blocking
│         │                      │         │
│         │     Unix Socket      │         │
│         │ ←──── audio ───────  │ Stream  │
└─────────┘                      └─────────┘
```

## Architecture

### Go Server Components

```
cmd/playground/main.go
    │
    ├── HTTP Server (Gin) :8180
    │   └── POST /session/:id/play   → Start streaming
    │   └── POST /session/:id/stop   → Stop streaming
    │   └── POST /session/:id/pause  → Pause streaming
    │   └── POST /session/:id/resume → Resume streaming
    │   └── GET  /session/:id/status → Get session state
    │
    └── Unix Socket Server (audio only)
        └── Streams audio chunks to connected client
```

### Session Flow

```
1. Node calls POST /session/abc123/play {url: "..."}
2. Go creates session, starts FFmpeg in goroutine
3. Go responds {status: "playing", session_id: "abc123"}
4. Go streams audio via Unix socket
5. Node calls POST /session/abc123/stop
6. Go cancels context, kills FFmpeg, closes audio stream
7. Go responds {status: "stopped"}
```

## Files to Modify/Create

### Go (Server)

| File | Action | Description |
|------|--------|-------------|
| `internal/server/api.go` | CREATE | Gin HTTP handlers |
| `internal/server/router.go` | CREATE | Gin router setup |
| `internal/server/session.go` | MODIFY | Add pause/resume state, multiple sessions |
| `internal/server/handler.go` | MODIFY | Remove command handling, audio-only |
| `internal/server/socket.go` | MODIFY | Simplify to audio streaming only |
| `cmd/playground/main.go` | MODIFY | Start both Gin and Socket servers |

### Node.js (Client)

| File | Action | Description |
|------|--------|-------------|
| `playground/src/api-client.ts` | CREATE | HTTP client for Gin API |
| `playground/src/websocket.ts` | MODIFY | Use API client for control |
| `playground/src/socket-client.ts` | MODIFY | Audio receiving only |

## API Design

### POST /session/:id/play
```json
Request:
{
  "url": "https://youtube.com/watch?v=...",
  "format": "pcm"
}

Response:
{
  "status": "playing",
  "session_id": "abc123"
}
```

### POST /session/:id/stop
```json
Response:
{
  "status": "stopped",
  "session_id": "abc123"
}
```

### POST /session/:id/pause
```json
Response:
{
  "status": "paused",
  "session_id": "abc123"
}
```

### POST /session/:id/resume
```json
Response:
{
  "status": "playing",
  "session_id": "abc123"
}
```

### GET /session/:id/status
```json
Response:
{
  "session_id": "abc123",
  "status": "playing|paused|stopped|error",
  "bytes_sent": 1234567,
  "duration_ms": 45000
}
```

## Session State Machine

```
     ┌─────────────────────────────────────┐
     │                                     │
     ▼                                     │
  [IDLE] ──play──► [EXTRACTING] ──► [STREAMING] ──stop──► [STOPPED]
                        │               │  ▲
                        │               │  │
                      error           pause/resume
                        │               │  │
                        ▼               ▼  │
                    [ERROR]         [PAUSED]
```

## Implementation Steps

### Phase 1: Go Gin Server (control)
1. Add Gin dependency: `go get github.com/gin-gonic/gin`
2. Create `internal/server/api.go` with handlers
3. Create `internal/server/router.go` with routes
4. Modify `cmd/playground/main.go` to start Gin on :8180

### Phase 2: Session Management
1. Modify `session.go` to support:
   - Pause/resume state (stop sending to output channel)
   - Multiple concurrent sessions (map instead of single)
   - Better state tracking

### Phase 3: Decouple Socket from Commands
1. Modify `socket.go` - remove command processing
2. Modify `handler.go` - audio streaming only
3. Socket just connects and receives audio for a session

### Phase 4: Node.js Client
1. Create `api-client.ts` for HTTP calls to Gin
2. Modify `websocket.ts` to use API client
3. Keep `socket-client.ts` for audio only

### Phase 5: Testing
1. Test play → stop → play cycle
2. Test pause → resume
3. Test multiple sessions (future)

## Pause Implementation Detail

Two options for pause:

**Option A: Stop sending chunks (recommended)**
- Go keeps FFmpeg running but stops sending to output channel
- Resume = start sending again
- Pro: Instant resume, no re-extraction
- Con: FFmpeg keeps running, uses resources

**Option B: Kill FFmpeg on pause**
- Pause = stop FFmpeg
- Resume = re-extract and seek to position
- Pro: No resource usage when paused
- Con: Slow resume, need seek position tracking

**Recommendation: Option A** for now (simpler, instant resume)

## Dependencies

```bash
# Go
go get github.com/gin-gonic/gin

# Node.js (no new deps, use native fetch)
```

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Two servers complexity | Clear separation of concerns |
| Race conditions | Proper mutex on session state |
| FFmpeg zombie processes | Context cancellation + process kill |
| Socket disconnect during play | Session cleanup on socket close |

## Success Criteria

- [ ] Stop command works immediately
- [ ] Play after stop works
- [ ] Pause/resume still works
- [ ] No FFmpeg zombie processes
- [ ] Clean session cleanup
