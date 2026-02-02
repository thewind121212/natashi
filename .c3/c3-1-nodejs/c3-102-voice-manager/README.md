# c3-102: Voice Manager

## Overview

The Voice Manager component handles Discord voice connections, audio player lifecycle, and Opus packet transmission using @discordjs/voice.

## Component Diagram

```mermaid
flowchart TB
    subgraph c3102["c3-102: Voice Manager"]
        CONN_MGR[Connection Manager]

        subgraph Connections["Voice Connections"]
            VC1[Guild 1 Connection]
            VC2[Guild 2 Connection]
            VCN[Guild N Connection]
        end

        subgraph Players["Audio Players"]
            AP1[Player 1]
            AP2[Player 2]
            APN[Player N]
        end

        CONN_MAP[(Connection Map<br/>guild_id → VoiceConnection)]
    end

    C101[c3-101<br/>Discord Bot]
    C104[c3-104<br/>Socket Client]
    DISCORD[Discord Voice Server]

    C101 -->|join/leave| CONN_MGR
    CONN_MGR --> CONN_MAP
    CONN_MAP --> Connections
    Connections --> Players

    C104 -->|Opus frames| Players
    Players -->|UDP| DISCORD
```

## Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Connection Lifecycle | Join, leave, reconnect voice channels |
| Audio Players | Create and manage audio players per guild |
| Frame Forwarding | Receive Opus from Socket Client, send to Discord |
| State Tracking | Track connection states per guild |
| Error Recovery | Handle disconnects and reconnection |

## Connection Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: join command
    Connecting --> Ready: connected
    Connecting --> Disconnected: failed
    Ready --> Playing: play command
    Playing --> Paused: pause command
    Paused --> Playing: resume command
    Playing --> Ready: track finished
    Ready --> Disconnected: stop/timeout
    Playing --> Disconnected: stop command
```

## Directory Structure

```
node/src/voice/
├── connection.ts     # VoiceConnection wrapper
├── player.ts         # AudioPlayer wrapper
└── index.ts          # Voice manager exports
```

## Dependencies

| Depends On | Purpose |
|------------|---------|
| c3-104 Socket Client | Receive Opus frames from Go |

| Depended By | Purpose |
|-------------|---------|
| c3-101 Discord Bot | Join/leave commands |

## Interfaces

### Voice Manager Interface

```typescript
interface VoiceManager {
  join(guildId: string, channelId: string): Promise<VoiceConnection>;
  leave(guildId: string): void;
  getConnection(guildId: string): VoiceConnection | undefined;
  playOpusStream(guildId: string, stream: Readable): void;
}
```

### Connection Map

```typescript
// Map of guild_id to active voice connection
const connections = new Map<string, VoiceConnection>();

// Map of guild_id to audio player
const players = new Map<string, AudioPlayer>();
```

## Audio Flow

```mermaid
sequenceDiagram
    participant SC as Socket Client
    participant VM as Voice Manager
    participant AP as Audio Player
    participant VC as Voice Connection
    participant DS as Discord Server

    SC->>VM: Opus frame (channel_id, seq, data)
    VM->>VM: Lookup player by channel_id
    VM->>AP: Write to Readable stream
    AP->>VC: Subscribe player
    VC->>DS: UDP packet (Opus)
```

## Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| Adapter | @discordjs/voice | Voice library |
| Self Deaf | true | Bot doesn't receive audio |
| Self Mute | false | Bot can transmit |

## Error Handling

| Error | Action |
|-------|--------|
| Connection lost | Attempt reconnect 3 times |
| Channel deleted | Clean up connection |
| Permissions revoked | Notify and disconnect |
| Player error | Log and continue with next track |
