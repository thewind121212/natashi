# Concurrent Sessions Test Plan

## Scope

- Discord Opus flow (guild-based sessions)
- Browser Ogg Opus flow (user-based sessions)
- Shared socket multiplexing with 24-byte session IDs

## Preconditions

- Go server running: `go run cmd/playground/main.go`
- Node server running: `task run:debug` or `task run:bot`
- `WEB_AUDIO=1` when testing browser Ogg Opus playback
- Discord bot invited and commands registered

## Discord Opus Flow

1. **Two guilds concurrently**
   - Start `/play` in Guild A and Guild B with different URLs
   - Expect both to play simultaneously, no audio crossing

2. **Same guild restart**
   - Start `/play` in Guild A
   - Run `/play` again with a new URL in Guild A
   - Expect previous stream stops and new one starts

3. **Stop cleanup**
   - Run `/stop` in Guild A
   - Expect voice disconnect and no residual audio

## Browser Ogg Opus Flow

1. **Two users concurrently**
   - Open two browsers with different Discord accounts
   - Play different URLs in each session
   - Expect both to play simultaneously, no audio crossing

2. **Same user restart**
   - Start playback, then play a new URL
   - Expect previous stream stops and new one starts

3. **Session routing**
   - Confirm each browser only receives its own stream
   - Check browser console for any routing errors

## Shared Socket + Routing

1. **Socket reconnect**
   - Restart Go server while Discord and browser are connected
   - Expect socket reconnect and sessions can be restarted cleanly

2. **Malformed packet handling (optional)**
   - Inject a test packet with length < 24
   - Expect a log message and no crash
