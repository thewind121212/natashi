# Discord Bot /play /stop - Progress Tracker

## Story
Add `/play` and `/stop` slash commands to play YouTube audio in Discord voice channel.

## Implementation Phases

| Phase | Description | Layer | Status |
|-------|-------------|-------|--------|
| 1 | Project Setup | Node.js | done |
| 2 | API & Socket Clients | Node.js | done |
| 3 | Voice Manager | Node.js | done |
| 4 | Discord Bot & Commands | Node.js | done |
| 5 | Integration & Testing | Both | pending |

## Tasks

### Phase 1: Project Setup

| ID | Task | C3 Component | Layer | State |
|----|------|--------------|-------|-------|
| S1 | Create node/ directory with package.json, tsconfig.json | - | Node.js | done |
| S2 | Add discord.js, @discordjs/voice, sodium-native deps | - | Node.js | done |
| S3 | Create config.ts and .env.example for bot token | - | Node.js | done |

### Phase 2: API & Socket Clients (Reuse from playground)

| ID | Task | C3 Component | Layer | State |
|----|------|--------------|-------|-------|
| N6 | Copy and adapt api-client.ts from playground | c3-104 | Node.js | done |
| N7 | Adapt socket-client.ts for OGG/Opus streaming | c3-105 | Node.js | done |

### Phase 3: Voice Manager

| ID | Task | C3 Component | Layer | State |
|----|------|--------------|-------|-------|
| N4 | Create voice/manager.ts - join/leave voice channel | c3-102 | Node.js | done |
| N5 | Create Opus stream bridge (socket → AudioResource) | c3-102 | Node.js | done |

### Phase 4: Discord Bot & Commands

| ID | Task | C3 Component | Layer | State |
|----|------|--------------|-------|-------|
| N1 | Create index.ts - bot login, slash command registration | c3-101 | Node.js | done |
| N2 | Create commands/play.ts - /play command handler | c3-101 | Node.js | done |
| N3 | Create commands/stop.ts - /stop command handler | c3-101 | Node.js | done |

### Phase 5: Integration & Testing

| ID | Task | C3 Component | Layer | State |
|----|------|--------------|-------|-------|
| I1 | Wire up full flow: command → voice → api → socket → player | c3-101, c3-102 | Node.js | done |
| I2 | Add to Taskfile.yml: task bot:dev command | - | Both | done |
| I3 | End-to-end test in Discord | - | Both | pending |

## Notes

- Go server already supports Opus: `format: "opus"` outputs OGG/Opus container
- Use `StreamType.OggOpus` in @discordjs/voice (no transcoding needed)
- Session ID = guild ID (one session per Discord server)
