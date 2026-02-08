# Natashi Music Bot - Agent Memory

## Key Bugs Found & Fixed

### Suppress Flag Leak (Auto-advance broken)
- **Pattern**: `suppressAutoAdvanceFor.add(guildId)` is set before `apiClient.stop()`, but if the track already finished naturally, Go does NOT send another `finished` event. The flag persists and blocks the NEXT track's auto-advance.
- **Fix**: Always call `session.suppressAutoAdvanceFor.delete(guildId)` after `waitForReady()` resolves. By that point, Go socket events are in-order so any old finished event has been processed.
- **Affected files**: next.ts, previous.ts, jump.ts, seek.ts, bot-actions.ts (startTrackOnGuild)

### Premature Close on Stream
- **Pattern**: `socketClient.endAudioStreamForSession()` calls `stream.end()` while Discord's AudioPlayer still reads from it.
- **Fix**: Call `voiceManager.stop(guildId)` BEFORE `endAudioStreamForSession()` to detach Discord first.

## Architecture Notes
- Discord bot uses `discordSessions` (DiscordSessionStore, keyed by guildId)
- Web playground uses `sessionStore` (SessionStore, keyed by userId)
- Both share the same `SocketClient` singleton - events fire to BOTH handlers
- `[Go] Event ... for unknown session` in websocket.ts is harmless - web store can't find Discord guild sessions
- Go `shortSessionID()` truncates to 8 chars for logs only - not a data issue
