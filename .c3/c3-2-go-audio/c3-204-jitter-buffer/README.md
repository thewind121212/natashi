# c3-204: Jitter Buffer

## Overview

The Jitter Buffer component smooths audio delivery by buffering Opus frames before transmission to Node.js, absorbing timing variations from encoding.

## Component Diagram

```mermaid
flowchart TB
    subgraph c3204["c3-204: Jitter Buffer"]
        BUFFER[Ring Buffer<br/>Capacity: 5 frames]
        SEQ[Sequence Manager]
        TIMER[Timing Controller<br/>20ms interval]
        OUTPUT[Frame Output]
    end

    C203[c3-203<br/>Opus Encoder]
    C104[c3-104<br/>Socket Client<br/>via Unix Socket]

    C203 -->|Opus frames| BUFFER
    BUFFER --> SEQ
    SEQ --> TIMER
    TIMER -->|20ms tick| OUTPUT
    OUTPUT -->|Binary frame| C104
```

## Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Frame Buffering | Buffer 3-5 frames before transmission |
| Sequence Numbering | Add sequence numbers for ordering |
| Timing Control | Send frames at precise 20ms intervals |
| Jitter Absorption | Smooth out encoder timing variations |
| Underrun Handling | Handle buffer underruns gracefully |

## Buffer Strategy

```mermaid
flowchart TB
    subgraph Buffer["Ring Buffer State"]
        EMPTY[Empty<br/>0 frames]
        FILLING[Filling<br/>1-2 frames]
        READY[Ready<br/>3-5 frames]
        FULL[Full<br/>5 frames]
    end

    EMPTY -->|frame in| FILLING
    FILLING -->|frame in| READY
    READY -->|frame in| FULL
    FULL -->|frame out| READY
    READY -->|frame out| FILLING
    FILLING -->|frame out| EMPTY
```

## Pre-buffering

```mermaid
sequenceDiagram
    participant ENC as Opus Encoder
    participant BUF as Jitter Buffer
    participant OUT as Output

    Note over BUF: Pre-buffer phase
    ENC->>BUF: Frame 1
    Note over BUF: Buffer: [1]
    ENC->>BUF: Frame 2
    Note over BUF: Buffer: [1,2]
    ENC->>BUF: Frame 3
    Note over BUF: Buffer: [1,2,3]<br/>Ready to send

    Note over BUF: Streaming phase
    loop Every 20ms
        BUF->>OUT: Send oldest frame
        ENC->>BUF: New frame
        Note over BUF: Maintains 3 frames
    end
```

## Directory Structure

```
go/internal/buffer/
├── jitter.go         # Jitter buffer implementation
├── ring.go           # Ring buffer data structure
└── timing.go         # Timing controller
```

## Dependencies

| Depended By | Purpose |
|-------------|---------|
| c3-201 Audio Processor | Buffer before transmission |
| c3-203 Opus Encoder | Provides frames to buffer |

## Interfaces

### Jitter Buffer Interface

```go
type JitterBuffer interface {
    // Add frame to buffer
    Push(frame []byte) error

    // Start outputting frames
    Start(ctx context.Context, output chan<- []byte)

    // Get buffer statistics
    Stats() BufferStats

    // Reset buffer
    Reset()
}

type BufferStats struct {
    CurrentSize  int
    TotalFrames  uint64
    Underruns    uint64
    Overruns     uint64
}
```

### Frame Format

```go
// Binary frame sent to Node.js
type OutputFrame struct {
    ChannelID uint64  // 8 bytes - Discord channel ID
    Sequence  uint32  // 4 bytes - Frame sequence number
    OpusData  []byte  // Variable - Opus encoded audio
}

// Wire format: [channel_id:8][sequence:4][opus_data:N]
```

## Buffer Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Capacity | 5 frames | 100ms max buffer |
| Pre-buffer | 3 frames | 60ms before start |
| Frame interval | 20ms | Discord requirement |
| Underrun threshold | 1 frame | Start sending when low |

## Timing Precision

```mermaid
flowchart TB
    subgraph Timing["20ms Timing"]
        TICKER[Ticker<br/>20ms interval]
        ADJUST[Drift Adjustment]
        SEND[Send Frame]
    end

    TICKER -->|tick| ADJUST
    ADJUST -->|compensate| SEND
```

## Underrun Handling

```mermaid
stateDiagram-v2
    [*] --> Normal
    Normal --> Underrun: buffer empty
    Underrun --> Normal: frames arrive
    Underrun --> Silence: prolonged underrun

    Note right of Silence: Send silence frames<br/>to maintain timing
```

| Condition | Action |
|-----------|--------|
| Buffer empty | Wait, don't send |
| Extended underrun | Send silence frame |
| Encoder catches up | Resume normal |

## Overrun Handling

| Condition | Action |
|-----------|--------|
| Buffer full | Drop oldest frame |
| Consistent overrun | Log warning |
| Encoder too fast | Apply backpressure |

## Sequence Numbering

```mermaid
flowchart LR
    subgraph Sequence["Sequence Management"]
        COUNTER[Counter<br/>uint32]
        WRAP[Wrap at 2^32]
        ASSIGN[Assign to frame]
    end

    COUNTER -->|increment| WRAP
    WRAP -->|number| ASSIGN
```

- Starts at 0
- Increments per frame
- Wraps at 2^32
- Node.js uses for ordering

## Performance

| Metric | Target |
|--------|--------|
| Jitter absorption | ±10ms |
| Output jitter | <2ms |
| Memory per buffer | ~10KB |
| CPU overhead | <1% |

## Error Handling

| Error | Action |
|-------|--------|
| Buffer overflow | Drop oldest, log |
| Buffer underrun | Skip frame, log |
| Timing drift | Auto-correct |
| Memory error | Fatal, restart worker |
