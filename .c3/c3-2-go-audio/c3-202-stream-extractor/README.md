# c3-202: Stream Extractor

## Overview

The Stream Extractor component uses yt-dlp to extract direct audio stream URLs from YouTube and other supported platforms.

## Component Diagram

```mermaid
flowchart TB
    subgraph c3202["c3-202: Stream Extractor"]
        EXTRACTOR[Extractor]
        VALIDATOR[URL Validator]
        CACHE[(URL Cache<br/>TTL: 5 min)]
        YTDLP[yt-dlp Process]
    end

    C201[c3-201<br/>Audio Processor]
    YOUTUBE[YouTube]

    C201 -->|URL| EXTRACTOR
    EXTRACTOR --> VALIDATOR
    VALIDATOR -->|valid| CACHE
    CACHE -->|miss| YTDLP
    YTDLP -->|HTTP| YOUTUBE
    YTDLP -->|stream URL| CACHE
    CACHE -->|stream URL| C201
```

## Responsibilities

| Responsibility | Description |
|---------------|-------------|
| URL Validation | Validate supported URLs (YouTube, etc.) |
| Stream Extraction | Use yt-dlp to get direct stream URL |
| Metadata Extraction | Get title, duration, thumbnail |
| Caching | Cache extracted URLs (short TTL) |
| Format Selection | Select best audio quality |

## Extraction Flow

```mermaid
sequenceDiagram
    participant AP as Audio Processor
    participant EX as Extractor
    participant CA as Cache
    participant YT as yt-dlp
    participant YS as YouTube

    AP->>EX: Extract(url)
    EX->>CA: Check cache

    alt Cache hit
        CA-->>EX: Cached stream URL
    else Cache miss
        EX->>YT: Execute yt-dlp
        YT->>YS: Fetch metadata
        YS-->>YT: Video info
        YT-->>EX: Stream URL + metadata
        EX->>CA: Store (TTL 5min)
    end

    EX-->>AP: StreamInfo
```

## Directory Structure

```
go/internal/extractor/
├── ytdlp.go          # yt-dlp wrapper
├── validator.go      # URL validation
├── cache.go          # URL cache
└── types.go          # Stream info types
```

## Dependencies

| Depends On | External |
|------------|----------|
| yt-dlp | CLI tool for extraction |

| Depended By | Purpose |
|-------------|---------|
| c3-201 Audio Processor | Get stream URLs |

## Interfaces

### Stream Info

```go
type StreamInfo struct {
    URL       string        // Direct stream URL
    Title     string        // Track title
    Duration  time.Duration // Track duration
    Thumbnail string        // Thumbnail URL
    Format    string        // Audio format (opus, m4a, etc.)
}
```

### Extractor Interface

```go
type Extractor interface {
    // Extract stream info from URL
    Extract(ctx context.Context, url string) (*StreamInfo, error)

    // Check if URL is supported
    IsSupported(url string) bool
}
```

## yt-dlp Command

```mermaid
flowchart LR
    subgraph Command["yt-dlp Command"]
        FLAGS["-f bestaudio<br/>--no-playlist<br/>--no-warnings<br/>-j"]
        URL[URL]
        OUTPUT[JSON output]
    end

    FLAGS --> URL --> OUTPUT
```

**Full command:**
```bash
yt-dlp -f bestaudio --no-playlist --no-warnings -j "URL"
```

## Supported Platforms

| Platform | URL Pattern | Status |
|----------|-------------|--------|
| YouTube | youtube.com, youtu.be | Supported |
| YouTube Music | music.youtube.com | Supported |
| SoundCloud | soundcloud.com | Planned |
| Spotify | spotify.com | Planned (via spotdl) |

## URL Validation

```mermaid
flowchart TB
    URL[Input URL]
    PARSE[Parse URL]
    CHECK_HOST{Host supported?}
    CHECK_PATH{Path valid?}
    VALID[Valid]
    INVALID[Invalid]

    URL --> PARSE
    PARSE --> CHECK_HOST
    CHECK_HOST -->|Yes| CHECK_PATH
    CHECK_HOST -->|No| INVALID
    CHECK_PATH -->|Yes| VALID
    CHECK_PATH -->|No| INVALID
```

## Cache Strategy

| Setting | Value | Rationale |
|---------|-------|-----------|
| TTL | 5 minutes | Stream URLs expire |
| Max Size | 1000 entries | Memory limit |
| Eviction | LRU | Keep recent extractions |

## Error Handling

| Error | Action |
|-------|--------|
| Invalid URL | Return validation error |
| yt-dlp not found | Fatal error on startup |
| Network error | Retry with backoff |
| Age-restricted | Return error to user |
| Private video | Return error to user |
| Extraction timeout | Cancel and return error |

## Performance

| Metric | Target |
|--------|--------|
| Extraction time | <3 seconds |
| Cache hit rate | >50% |
| Memory per entry | ~1KB |
