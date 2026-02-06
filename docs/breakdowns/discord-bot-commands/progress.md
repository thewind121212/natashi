# Discord Bot Commands - Progress Tracker

## Story
Add essential playback control commands to Discord bot: `/pause`, `/resume`, `/skip`, `/queue`, `/nowplaying`, `/previous`, `/status`

## Layer
Node.js only (Go API already has all endpoints)

## Status: COMPLETED

## Tasks

### Phase 1: Foundation

| ID | Task | File | C3 | State |
|----|------|------|-----|-------|
| T01 | Create Discord Session Store | `app/src/discord/session-store.ts` | c3-101 | done |

### Phase 2: Update /play

| ID | Task | File | C3 | State |
|----|------|------|-----|-------|
| T02 | Update /play with queue support | `app/src/commands/play.ts` | c3-101 | done |

### Phase 3: Essential Commands

| ID | Task | File | C3 | State |
|----|------|------|-----|-------|
| T03 | Create /pause command | `app/src/commands/pause.ts` | c3-101 | done |
| T04 | Create /resume command | `app/src/commands/resume.ts` | c3-101 | done |
| T05 | Create /skip command | `app/src/commands/skip.ts` | c3-101 | done |

### Phase 4: Queue Commands

| ID | Task | File | C3 | State |
|----|------|------|-----|-------|
| T06 | Create /queue command | `app/src/commands/queue.ts` | c3-101 | done |
| T07 | Create /nowplaying command | `app/src/commands/nowplaying.ts` | c3-101 | done |
| T08 | Create /previous command | `app/src/commands/previous.ts` | c3-101 | done |

### Phase 5: Status Command

| ID | Task | File | C3 | State |
|----|------|------|-----|-------|
| T09 | Create /status command | `app/src/commands/status.ts` | c3-101 | done |

### Phase 6: Register

| ID | Task | File | C3 | State |
|----|------|------|-----|-------|
| T10 | Register all commands | `app/src/commands/index.ts` | c3-101 | done |

## Verification

- TypeScript build: PASS
- All commands registered: 9 commands

## Files Created/Modified

### New Files (9)
- `app/src/discord/session-store.ts`
- `app/src/commands/pause.ts`
- `app/src/commands/resume.ts`
- `app/src/commands/skip.ts`
- `app/src/commands/queue.ts`
- `app/src/commands/nowplaying.ts`
- `app/src/commands/previous.ts`
- `app/src/commands/status.ts`

### Modified Files (3)
- `app/src/commands/play.ts` - Added queue support, metadata fetch, auto-advance
- `app/src/commands/stop.ts` - Added session reset
- `app/src/commands/index.ts` - Registered all commands

## Completed: 2026-02-06
