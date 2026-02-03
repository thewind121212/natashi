---
name: implement-feature-reviewing
description: Use when reviewing a feature implementation - compares actual code against planning documents for Discord music bot (Node.js + Go), validates architecture compliance, and creates a checklist report with pass/fail status
---

# Feature Implementation Review

## Overview

This skill reviews implemented features by **comparing actual code against planning documents**. It validates that implementation follows the plan and hybrid Node.js/Go architecture, producing a detailed checklist report.

**Prerequisite:**
- Planning documents in `docs/plans/adr-{YYYYMMDD}-{feature-name}/`
- Implementation completed

**Output:** `docs/plans/adr-{YYYYMMDD}-{feature-name}/review-checklist.md`

## System Architecture Reference

```mermaid
flowchart TB
    subgraph Browser
        USER[User]
        WEBUI[Web UI]
    end

    subgraph Playground["Node.js Playground"]
        WS[WebSocket Server]
        API_C[API Client]
        SOCK_C[Socket Client]
        PLAYER[Audio Player]
    end

    subgraph IPC["Communication"]
        HTTP[HTTP :8180]
        SOCKET[Unix Socket]
    end

    subgraph Go["Go Audio Server"]
        API[Gin API]
        SESSION[Session Manager]
        EXTRACT[yt-dlp]
        ENCODE[FFmpeg]
    end

    USER --> WEBUI --> WS
    WS --> API_C --> HTTP --> API
    WS --> SOCK_C --> SOCKET
    SOCKET <--> ENCODE
    API --> SESSION --> EXTRACT --> ENCODE
    SOCK_C --> PLAYER
```

## Review Flow

```mermaid
flowchart TB
    READ_PLAN[1. Read Planning<br/>Documents]
    SCAN_CODE[2. Scan Actual<br/>Code Changes]
    COMPARE_FILES[3. Compare Files<br/>vs impacts.md]
    VALIDATE_IMPL[4. Validate Against<br/>implementations.md]
    CHECK_ARCH[5. Check Architecture<br/>Compliance]
    VERIFY_AUDIO[6. Verify Audio<br/>Quality Settings]
    CREATE_REPORT[7. Create Review<br/>Checklist Report]

    READ_PLAN --> SCAN_CODE --> COMPARE_FILES --> VALIDATE_IMPL --> CHECK_ARCH --> VERIFY_AUDIO --> CREATE_REPORT
```

## Step 1: Read Planning Documents

**Read all planning documents:**

```
docs/plans/adr-{YYYYMMDD}-{feature-name}/
├── implementations.md   # Expected task list
├── impacts.md          # Expected files
└── diagrams.md         # Expected architecture
```

### Extract from each document:

| Document | Extract |
|----------|---------|
| `implementations.md` | Phase tasks, checklist items |
| `impacts.md` | New files list, modified files list |
| `diagrams.md` | Component relationships, data flows |

**If planning documents don't exist:**
> Stop and report: "Planning documents not found. Cannot review without baseline."

## Step 2: Scan Actual Code Changes

**Scan the project directories:**

### Node.js Structure (playground/)

```mermaid
flowchart TB
    subgraph NodeJS["playground/src/"]
        INDEX[index.ts]
        SERVER[server.ts]
        WEBSOCKET[websocket.ts]
        API_CLIENT[api-client.ts]
        SOCKET_CLIENT[socket-client.ts]
        AUDIO_PLAYER[audio-player.ts]
    end

    subgraph WebUI["playground/public/"]
        HTML[index.html]
        JS[app.js]
    end
```

### Go Structure (internal/)

```mermaid
flowchart TB
    subgraph Go["Go Application"]
        subgraph Cmd["cmd/playground/"]
            MAIN[main.go]
        end

        subgraph Server["internal/server/"]
            API[api.go]
            ROUTER[router.go]
            SESSION[session.go]
            SOCKET[socket.go]
            TYPES[types.go]
        end

        subgraph Encoder["internal/encoder/"]
            FFMPEG[ffmpeg.go]
            ENC[encoder.go]
        end

        subgraph Platform["internal/platform/"]
            YOUTUBE[youtube/youtube.go]
        end
    end
```

## Step 3: Compare Files vs impacts.md

### For New Files:

```mermaid
flowchart TB
    START[For each file in impacts.md]
    CHECK{File exists?}
    PASS[✅ PASS<br/>File created as planned]
    FAIL[❌ FAIL<br/>File missing]

    START --> CHECK
    CHECK -->|Yes| PASS
    CHECK -->|No| FAIL
```

### For Modified Files:

```mermaid
flowchart TB
    START[For each modified file in impacts.md]
    CHECK{File was modified?}
    PASS[✅ PASS<br/>Modified as planned]
    FAIL[❌ FAIL<br/>Not modified]

    START --> CHECK
    CHECK -->|Yes| PASS
    CHECK -->|No| FAIL
```

### Unexpected Files:

```
For each file NOT in impacts.md:
    ⚠️ WARNING: "{file} created but not in plan"
```

## Step 4: Validate Against implementations.md

### Check Each Phase Task:

**Phase 1: Protocol Changes**

```mermaid
flowchart TB
    subgraph Protocol["Protocol Validation"]
        CMD_TYPE{Command type<br/>defined?}
        EVENT_TYPE{Event type<br/>defined?}
        SCHEMA{Schema<br/>matches?}
    end

    CMD_TYPE -->|Yes| EVENT_TYPE
    EVENT_TYPE -->|Yes| SCHEMA
```

| Check | Validation |
|-------|------------|
| Command types | New command in protocol? |
| Event types | New event in protocol? |
| Channel ID | Included in all messages? |

**Phase 2: Go Changes**

| Check | Validation |
|-------|------------|
| Handler exists | Command handler implemented? |
| Worker integration | Worker pool updated? |
| Error handling | Errors sent back to Node? |

**Phase 3: Node.js Changes**

| Check | Validation |
|-------|------------|
| Command registered | Slash command exists? |
| Socket integration | Sends to Go correctly? |
| Event handling | Handles Go responses? |
| User feedback | Sends Discord response? |

**Phase 4: Integration**

| Check | Validation |
|-------|------------|
| End-to-end flow | Command → Go → Response works? |
| Error propagation | Errors reach user? |

## Step 5: Check Architecture Compliance

### Layer Boundaries

```mermaid
flowchart TB
    subgraph Correct["✅ Correct Dependencies"]
        N1[Node.js Commands] --> N2[Socket Client]
        N2 --> G1[Go Handler]
        G1 --> G2[Worker]
        G2 --> G3[Encoder]
    end
```

```mermaid
flowchart TB
    subgraph Wrong["❌ Wrong Dependencies"]
        N1[Node.js Commands] -.->|Direct call| G2[Go Worker]
        G1[Go Handler] -.->|Import| N2[Node.js Queue]
    end
```

### Architecture Rules

| Rule | Check |
|------|-------|
| Node.js is brain | All state decisions in Node.js? |
| Go is audio only | No Discord logic in Go? |
| Unix socket IPC | No HTTP between Node/Go? |
| Channel ID routing | All messages include channel_id? |

### C3 Component Compliance

```mermaid
flowchart TB
    subgraph C3Check["C3 Component Checks"]
        C101{c3-101<br/>Discord Bot<br/>Commands only?}
        C102{c3-102<br/>Voice Manager<br/>@discordjs/voice?}
        C103{c3-103<br/>Queue Manager<br/>State in Node?}
        C104{c3-104<br/>Socket Client<br/>Unix socket?}
        C201{c3-201<br/>Audio Processor<br/>Worker pool?}
    end
```

## Step 6: Verify Audio Quality Settings

### PCM Streaming Requirements (Debug Mode)

| Setting | Required | Check |
|---------|----------|-------|
| Sample Rate | 48000 Hz | FFmpeg `-ar 48000`? |
| Channels | 2 (stereo) | FFmpeg `-ac 2`? |
| Format | s16le | FFmpeg `-f s16le`? |
| Streaming | Real-time | FFmpeg `-re` flag? |

### Low-Latency Flags

| Setting | Required | Check |
|---------|----------|-------|
| No buffer | `-fflags nobuffer` | Input not buffered? |
| Low delay | `-flags low_delay` | Low latency mode? |
| Fast probe | `-probesize 32` | Quick startup? |
| No analysis | `-analyzeduration 0` | Skip analysis? |

### FFmpeg Command Validation

```mermaid
flowchart LR
    subgraph FFmpeg["Required FFmpeg Flags"]
        R1["-fflags nobuffer"]
        R2["-flags low_delay"]
        R3["-re"]
        R4["-ar 48000"]
        R5["-ac 2"]
        R6["-f s16le"]
    end
```

## Step 7: Create Review Checklist Report

**Create file:** `docs/plans/adr-{YYYYMMDD}-{feature-name}/review-checklist.md`

### Report Template:

```markdown
# {Feature Name} Implementation Review

**Review Date:** {YYYY-MM-DD}
**Planning Date:** {from folder name}
**Status:** {PASSED | FAILED | PASSED WITH WARNINGS}

## Summary

| Category | Passed | Failed | Warnings |
|----------|--------|--------|----------|
| File Creation | X | Y | Z |
| File Modification | X | Y | Z |
| Protocol Compliance | X | Y | Z |
| Go Implementation | X | Y | Z |
| Node.js Implementation | X | Y | Z |
| Architecture | X | Y | Z |
| Audio Quality | X | Y | Z |
| **Total** | **X** | **Y** | **Z** |

## Architecture Diagram

{Mermaid diagram showing implemented architecture}

## File Checklist

### New Files
| Status | File | Notes |
|--------|------|-------|
| ✅ | `node/src/commands/newcmd.ts` | Created as planned |
| ❌ | `go/internal/handler/newcmd.go` | Missing |

### Modified Files
| Status | File | Notes |
|--------|------|-------|
| ✅ | `go/internal/server/handler.go` | Handler added |
| ❌ | `node/src/socket/commands.ts` | Not modified |

### Unexpected Files
| Status | File | Notes |
|--------|------|-------|
| ⚠️ | `node/src/utils/helper.ts` | Not in plan |

## Implementation Task Checklist

### Phase 1: Protocol Changes
| Status | Task | Notes |
|--------|------|-------|
| ✅ | Define command type | Added to protocol |
| ✅ | Define event type | Added to protocol |

### Phase 2: Go Changes
| Status | Task | Notes |
|--------|------|-------|
| ✅ | Add handler | Implemented |
| ❌ | Update worker | Missing |

### Phase 3: Node.js Changes
| Status | Task | Notes |
|--------|------|-------|
| ✅ | Register command | Slash command works |
| ✅ | Handle response | Event handled |

### Phase 4: Integration
| Status | Task | Notes |
|--------|------|-------|
| ✅ | End-to-end test | Flow verified |

## Architecture Compliance

| Status | Check | Notes |
|--------|-------|-------|
| ✅ | Node.js owns state | Queue in Node.js |
| ✅ | Go audio only | No Discord imports |
| ✅ | Unix socket IPC | Using /tmp/music.sock |
| ❌ | Channel ID routing | Missing in one message |

## Audio Quality Checklist

| Status | Setting | Required | Actual |
|--------|---------|----------|--------|
| ✅ | Sample Rate | 48000 Hz | 48000 Hz |
| ✅ | Channels | 2 | 2 |
| ✅ | Frame Size | 20ms | 20ms |
| ❌ | Jitter Buffer | 3-5 frames | 2 frames |

## Violations Summary

### Critical (Must Fix)

1. ❌ **Missing file:** `go/internal/handler/newcmd.go`
   - Impact: Command won't be processed
   - Fix: Create handler following existing pattern

2. ❌ **Architecture violation:** Channel ID missing
   - Location: `node/src/socket/commands.ts:45`
   - Fix: Add channel_id to message

### Warnings (Should Fix)

1. ⚠️ **Unexpected file:** `node/src/utils/helper.ts`
   - Action: Update impacts.md or remove

2. ⚠️ **Jitter buffer undersized:** 2 frames instead of 3-5
   - Impact: May cause audio stuttering
   - Recommendation: Increase buffer size

## Data Flow Verification

{Mermaid sequence diagram showing actual implementation}

## Conclusion

**Overall Status: {PASSED | FAILED}**

{If FAILED:}
This implementation has {X} critical violations that must be fixed.

{If PASSED:}
This implementation follows the planning documents and architecture.
```

## Status Determination

```mermaid
flowchart TB
    START[Review Complete]
    CRITICAL{Any critical<br/>violations?}
    WARNINGS{Any warnings?}
    FAILED[❌ FAILED]
    PASS_WARN[⚠️ PASSED WITH WARNINGS]
    PASSED[✅ PASSED]

    START --> CRITICAL
    CRITICAL -->|Yes| FAILED
    CRITICAL -->|No| WARNINGS
    WARNINGS -->|Yes| PASS_WARN
    WARNINGS -->|No| PASSED
```

### FAILED (Any of these):
- Missing planned file
- Planned modification not made
- Architecture boundary violated
- Audio quality settings wrong
- Protocol mismatch

### PASSED WITH WARNINGS:
- All critical checks pass
- Has unexpected files
- Minor audio tuning needed

### PASSED:
- All files match plan
- All tasks completed
- Architecture correct
- Audio quality verified

## Review Workflow

```mermaid
flowchart TB
    A[1. Read planning docs]
    B[2. Scan Node.js code]
    C[3. Scan Go code]
    D[4. Compare to impacts.md]
    E[5. Validate implementations.md]
    F[6. Check architecture]
    G[7. Verify audio settings]
    H[8. Write review-checklist.md]
    I[9. Report to user]

    A --> B
    A --> C
    B --> D
    C --> D
    D --> E --> F --> G --> H --> I
```

## Usage Example

```
User: Review the volume-control feature implementation

Claude:
1. Reads docs/plans/adr-20260202-volume-control/
2. Scans node/src/ and go/internal/
3. Compares files against impacts.md
4. Validates tasks against implementations.md
5. Checks architecture compliance
6. Verifies audio quality settings
7. Creates review-checklist.md with results
8. Reports: "Review complete: 18 passed, 2 failed, 1 warning"
```

## Error Handling

### If planning documents missing:
```
"Cannot review: Planning documents not found at docs/plans/adr-{date}-{feature-name}/.
Please ensure the implement-feature-planning skill was run first."
```

### If code directories missing:
```
"Cannot review: Code not found at node/src/ or go/internal/.
Please ensure the feature was implemented before reviewing."
```

## Checklist Before Completion

Review skill must verify:

- [ ] All files in impacts.md checked
- [ ] All tasks in implementations.md validated
- [ ] Architecture boundaries verified
- [ ] Audio quality settings confirmed
- [ ] Review report created with mermaid diagrams
- [ ] Overall status determined
- [ ] Violations clearly documented
- [ ] Fix recommendations provided
