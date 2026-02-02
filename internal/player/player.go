package player

import "context"

// AudioPlayer defines the interface for playing audio streams.
// This follows the Dependency Inversion Principle (DIP).
type AudioPlayer interface {
	// Play starts playing the audio from the given stream URL.
	// It blocks until playback is complete or the context is cancelled.
	Play(ctx context.Context, streamURL string) error

	// Name returns the player implementation name (e.g., "ffmpeg")
	Name() string
}

// Config holds player configuration options.
type Config struct {
	Channels   int    // Number of audio channels (default: 2)
	SampleRate int    // Sample rate in Hz (default: 48000)
	Device     string // Output device (default: "default")
}

// DefaultConfig returns the default player configuration.
func DefaultConfig() Config {
	return Config{
		Channels:   2,
		SampleRate: 48000,
		Device:     "default",
	}
}
