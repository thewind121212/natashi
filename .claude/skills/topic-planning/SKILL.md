---
name: implement-feature-planning
description: Use when planning a new feature before implementation - analyzes requirements against C3 architecture for Discord music bot (Node.js + Go), identifies impacts, and creates structured planning documents with mermaid diagrams
---

# Feature Implementation Planning

## Overview

This skill guides the **planning phase** before feature implementation for the Discord Music Bot. It produces structured documentation that maps requirements to the hybrid Node.js/Go architecture.

**Output:** `docs/plans/adr-{YYYYMMDD}-{feature-name}/`

**When to use:**
- Before implementing any new feature
- When requirements need architectural analysis
- When impact assessment is required

## System Architecture Reference

```mermaid
flowchart TB
    subgraph External["External"]
        BROWSER[Browser]
        YOUTUBE[YouTube]
    end

    subgraph Playground["Node.js Playground"]
        WS[WebSocket Server]
        API_C[API Client]
        SOCK_C[Socket Client]
        PLAYER[Audio Player]
    end

    subgraph Go["Go Audio Server :8180"]
        API[Gin API]
        SESSION[Session Manager]
        EXTRACT[Stream Extractor]
        ENCODE[FFmpeg Encoder]
        SOCKET[Socket Server]
    end

    BROWSER -->|WebSocket| WS
    WS --> API_C -->|HTTP :8180| API
    WS --> SOCK_C <-->|Unix Socket| SOCKET
    SOCK_C --> PLAYER -->|ffplay| BROWSER
    API --> SESSION --> EXTRACT -->|yt-dlp| YOUTUBE
    EXTRACT --> ENCODE --> SOCKET
```

## Planning Flow

```mermaid
flowchart TB
    REQ[1. Understand<br/>Requirements]
    C3[2. Analyze C3<br/>Architecture]
    LAYER[3. Determine<br/>Layer Impact]
    IMPACTS[4. Identify<br/>File Changes]
    IMPL[5. Create<br/>Implementation Plan]
    DIAGRAMS[6. Design<br/>Mermaid Diagrams]
    DOCS[7. Write<br/>Documentation]

    REQ --> C3 --> LAYER --> IMPACTS --> IMPL --> DIAGRAMS --> DOCS
```

## Step 1: Understand Requirements

**Read and confirm understanding of:**

1. **Key questions to answer:**
   - What Discord command triggers this feature?
   - Does this affect Node.js, Go, or both?
   - What audio processing is needed?
   - What state changes are required?
   - What user feedback is needed?

2. **Output:** Clear problem statement and scope definition

## Step 2: Analyze C3 Architecture

**Read and understand current architecture:**

1. **C3 documentation to read:**
   - `.c3/README.md` - System overview
   - `.c3/c3-0-context/README.md` - System context
   - `.c3/c3-1-nodejs/README.md` - Node.js container
   - `.c3/c3-2-go-audio/README.md` - Go container
   - `.c3/c3-1-nodejs/c3-1XX-*/README.md` - Node.js components
   - `.c3/c3-2-go-audio/c3-2XX-*/README.md` - Go components

2. **C3 Components:**

```mermaid
flowchart TB
    subgraph C3_1["C3-1: Node.js Components"]
        C101[c3-101<br/>Discord Bot]
        C102[c3-102<br/>Voice Manager]
        C103[c3-103<br/>Queue Manager]
        C104[c3-104<br/>API Client]
        C105[c3-105<br/>Socket Client]
    end

    subgraph C3_2["C3-2: Go Components"]
        C201[c3-201<br/>Gin API Server]
        C202[c3-202<br/>Session Manager]
        C203[c3-203<br/>Stream Extractor]
        C204[c3-204<br/>Opus Encoder]
        C205[c3-205<br/>Jitter Buffer]
        C206[c3-206<br/>Socket Server]
    end

    C101 --> C102 --> C104
    C101 --> C103
    C104 -->|HTTP :8180| C201
    C105 <-->|Socket| C206
    C201 --> C202 --> C203 --> C204 --> C205 --> C206
```

3. **Questions to answer:**
   - Which C3 components will this feature interact with?
   - Does this require a new C3 component?
   - What are the dependency relationships?

**Output:** Architecture context and integration points

## Step 3: Determine Layer Impact

**Identify which layers are affected:**

| Layer | Technology | Affected? |
|-------|------------|-----------|
| Browser HTTP API | Node.js + Express | ? |
| Browser WebSocket | Node.js + ws | ? |
| Discord Commands | Node.js + discord.js | ? |
| Voice Management | Node.js + @discordjs/voice | ? |
| Queue State | Node.js | ? |
| HTTP Control API | Go + Gin | ? |
| Session Management | Go | ? |
| Stream Extraction | Go + yt-dlp | ? |
| Audio Encoding | Go + FFmpeg | ? |
| Audio Streaming | Unix Socket | ? |

**Output:** Layer impact matrix

## Step 4: Identify File Changes

**Analyze impacts across:**

### Node.js Layer (playground/)

```mermaid
flowchart TB
    subgraph NodeJS["playground/src/"]
        INDEX[index.ts - entry point]
        SERVER[server.ts - HTTP server]
        WEBSOCKET[websocket.ts - browser connection]
        API_CLIENT[api-client.ts - Go HTTP API]
        SOCKET_CLIENT[socket-client.ts - Go audio socket]
        AUDIO_PLAYER[audio-player.ts - ffplay wrapper]
    end

    subgraph WebUI["playground/public/"]
        HTML[index.html]
        JS[app.js]
    end
```

### Go Layer (internal/)

```mermaid
flowchart TB
    subgraph Go["Go Application"]
        subgraph Cmd["cmd/playground/"]
            MAIN[main.go - entry point]
        end

        subgraph Server["internal/server/"]
            API[api.go - Gin HTTP API]
            ROUTER[router.go - routes]
            SESSION[session.go - playback state]
            SOCKET[socket.go - audio streaming]
            TYPES[types.go - Command/Event types]
        end

        subgraph Encoder["internal/encoder/"]
            FFMPEG[ffmpeg.go - real-time transcoding]
            ENC[encoder.go - pipeline interface]
        end

        subgraph Platform["internal/platform/"]
            YOUTUBE[youtube/youtube.go - yt-dlp extraction]
        end
    end
```

**Output:** Complete file inventory (new + modified)

## Step 5: Create Implementation Plan

**Structure the implementation as ordered tasks:**

### Phase 1: Protocol Changes (if any)

```mermaid
sequenceDiagram
    participant N as Node.js
    participant G as Go

    Note over N,G: Define new command/event types
    N->>G: {"type": "new_command", ...}
    G-->>N: {"type": "new_event", ...}
```

### Phase 2: Go Changes

| Order | Task | File | Description |
|-------|------|------|-------------|
| 1 | ... | `go/internal/...` | ... |

### Phase 3: Node.js Changes

| Order | Task | File | Description |
|-------|------|------|-------------|
| 1 | ... | `node/src/...` | ... |

### Phase 4: Integration

| Order | Task | File | Description |
|-------|------|------|-------------|
| 1 | ... | ... | ... |

### Phase 5: Testing

| Order | Task | File | Description |
|-------|------|------|-------------|
| 1 | ... | ... | ... |

**Output:** Ordered task list with dependencies

## Step 6: Design Mermaid Diagrams

**Create diagrams for:**

### 1. Command Flow

```mermaid
sequenceDiagram
    participant U as User
    participant D as Discord Bot
    participant Q as Queue Manager
    participant S as Socket Client
    participant G as Go Worker

    U->>D: /command
    D->>Q: Update state
    D->>S: Send to Go
    S->>G: Process
    G-->>S: Result
    S-->>D: Event
    D-->>U: Response
```

### 2. Component Integration

```mermaid
flowchart LR
    subgraph Affected["Affected Components"]
        A[Component A]
        B[Component B]
    end

    subgraph Unchanged["Unchanged"]
        C[Component C]
    end

    A --> B
    B --> C
```

### 3. State Changes

```mermaid
stateDiagram-v2
    [*] --> State1
    State1 --> State2: action
    State2 --> [*]
```

**Output:** Mermaid diagrams for all perspectives

## Step 7: Write Documentation

**Create planning documents:**

### Directory Structure

```bash
mkdir -p docs/plans/adr-{YYYYMMDD}-{feature-name}
```

### 7.1 implementations.md

```markdown
# {Feature Name} Implementation Plan

## Overview
- Goal: {feature goal}
- Scope: {what's included/excluded}
- Affected Layers: {Node.js / Go / Both}

## Command Flow

{Mermaid sequence diagram}

## Implementation Phases

### Phase 1: Protocol Changes
| Task | File | Description |
|------|------|-------------|
| ... | ... | ... |

### Phase 2: Go Changes
| Task | File | Description |
|------|------|-------------|
| ... | ... | ... |

### Phase 3: Node.js Changes
| Task | File | Description |
|------|------|-------------|
| ... | ... | ... |

### Phase 4: Integration
| Task | File | Description |
|------|------|-------------|
| ... | ... | ... |

### Phase 5: Testing
| Task | File | Description |
|------|------|-------------|
| ... | ... | ... |

## Checklist
- [ ] Protocol types updated (if needed)
- [ ] Go worker handles new command
- [ ] Node.js command registered
- [ ] Socket communication tested
- [ ] Audio quality verified (48kHz, 20ms frames)
- [ ] Error handling implemented
- [ ] User feedback provided
```

### 7.2 impacts.md

```markdown
# {Feature Name} Impact Analysis

## Summary
| Category | Count | Risk |
|----------|-------|------|
| New Go Files | {X} | Low |
| New Node.js Files | {Y} | Low |
| Modified Files | {Z} | Medium |

## New Files

### Go Layer
| File | Purpose |
|------|---------|
| `go/internal/...` | ... |

### Node.js Layer
| File | Purpose |
|------|---------|
| `node/src/...` | ... |

## Modified Files

| File | Change | Risk |
|------|--------|------|
| ... | ... | ... |

## C3 Component Dependencies

| This Feature | Depends On | Reason |
|--------------|------------|--------|
| ... | c3-1XX | ... |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ... | ... | ... | ... |
```

### 7.3 diagrams.md

```markdown
# {Feature Name} Diagrams

## Command Flow

{Mermaid sequence diagram}

## Component Integration

{Mermaid flowchart}

## State Machine

{Mermaid state diagram}

## Audio Flow (if applicable)

{Mermaid flowchart showing audio pipeline}
```

## Validation Checklist

Before completing planning:

- [ ] Requirements clearly understood
- [ ] C3 components identified
- [ ] Layer impacts determined
- [ ] All file changes listed
- [ ] Implementation phases ordered
- [ ] Dependencies identified
- [ ] Mermaid diagrams created
- [ ] All three documents written

## Usage

```
User: Plan the implementation of {feature name}

Claude:
1. Reads requirements
2. Analyzes C3 architecture
3. Determines layer impacts
4. Creates docs/plans/adr-{date}-{feature-name}/
   - implementations.md
   - impacts.md
   - diagrams.md
```
