# Discord Bot Commands Impact Analysis

## Summary

| Category | Count | Risk |
|----------|-------|------|
| New Node.js Files | 9 | Low |
| New Go Files | 0 | - |
| Modified Node.js Files | 2 | Medium |
| Modified Go Files | 0 | - |

**Total files affected:** 11

## New Files

### Node.js Layer

| File | Purpose | Lines (est) |
|------|---------|-------------|
| `app/src/discord/session-store.ts` | Per-guild state management (queue, pause, track) | ~60 |
| `app/src/commands/pause.ts` | `/pause` command | ~40 |
| `app/src/commands/resume.ts` | `/resume` command | ~40 |
| `app/src/commands/skip.ts` | `/skip` command | ~50 |
| `app/src/commands/queue.ts` | `/queue` command with embed | ~70 |
| `app/src/commands/nowplaying.ts` | `/nowplaying` command with embed | ~50 |
| `app/src/commands/previous.ts` | `/previous` command | ~50 |
| `app/src/commands/status.ts` | `/status` command | ~40 |

### Go Layer

None - all required endpoints already exist.

## Modified Files

| File | Change | Risk | Details |
|------|--------|------|---------|
| `app/src/commands/play.ts` | Major refactor | Medium | Add queue support, metadata fetch, auto-advance |
| `app/src/commands/index.ts` | Add exports | Low | Import and export 7 new commands |

## C3 Component Dependencies

| This Feature | Depends On | Reason |
|--------------|------------|--------|
| New commands | c3-101 Discord Bot | Command registration |
| New commands | c3-102 Voice Manager | Check connection, play stream |
| New commands | c3-104 API Client | pause/resume/stop/play/health calls |
| New commands | c3-105 Socket Client | Audio stream management |
| New commands | c3-103 Queue Manager | Reuse existing class |
| Session Store | c3-103 Queue Manager | Each guild gets a QueueManager instance |

```mermaid
flowchart TB
    subgraph NewCode["New Code"]
        STORE[Discord Session Store]
        PAUSE[/pause]
        RESUME[/resume]
        SKIP[/skip]
        QUEUE[/queue]
        NP[/nowplaying]
        PREV[/previous]
        STATUS[/status]
    end

    subgraph Existing["Existing (No Changes)"]
        C101[c3-101 Discord Bot]
        C102[c3-102 Voice Manager]
        C103[c3-103 Queue Manager]
        C104[c3-104 API Client]
        C105[c3-105 Socket Client]
    end

    subgraph Modified["Modified"]
        PLAY[/play command]
        INDEX[commands/index.ts]
    end

    STORE --> C103
    PAUSE --> STORE
    PAUSE --> C102
    PAUSE --> C104
    RESUME --> STORE
    RESUME --> C104
    SKIP --> STORE
    SKIP --> C104
    SKIP --> C105
    QUEUE --> STORE
    NP --> STORE
    PREV --> STORE
    PREV --> C104
    PREV --> C105
    STATUS --> C104
    PLAY --> STORE
    PLAY --> C103
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| State desync with Go | Low | Medium | Reset state on socket 'error' and 'finished' events |
| Memory leak (sessions not cleaned) | Low | Low | Delete session when bot leaves voice channel |
| Race condition on skip | Medium | Low | Use request ID pattern (like web flow) |
| Wrong session on multi-guild | Low | High | Always use guildId from interaction, never assume |

## Isolation from Web Flow

**Critical**: Discord bot flow and Web flow are completely separate:

| Aspect | Discord Bot | Web/Playground |
|--------|-------------|----------------|
| Session ID | `guildId` | `userId` (Discord OAuth) |
| State Store | `DiscordSessionStore` (NEW) | `SessionStore` + SQLite |
| Format | `opus` | `pcm` or `web` |
| Auto-advance | In `play.ts` event handler | In `websocket.ts` |
| Persistence | None (memory only) | SQLite |

**No shared state between flows** - they can run simultaneously without interference.

## Backwards Compatibility

| Change | Compatible? | Notes |
|--------|-------------|-------|
| `/play` with queue | Yes | Single URL still works, just adds to queue |
| `/stop` behavior | Yes | Still stops and leaves, also clears queue |
| Existing bot users | Yes | New commands are additive |

## Testing Impact

| Test Type | Scope | Notes |
|-----------|-------|-------|
| Manual QA | Required | Test all 8 commands in Discord |
| Unit tests | Optional | Session store logic |
| Integration | Required | Verify auto-advance works |
| Multi-guild | Required | Test with 2 servers simultaneously |
