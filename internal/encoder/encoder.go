// Package encoder provides audio encoding pipeline for the music bot.
// It handles stream decoding via FFmpeg and encoding to Opus format.
package encoder

import "context"

// Format specifies the output format for encoded audio.
type Format string

const (
	// FormatPCM outputs raw PCM s16le (for debug playback via ffplay).
	FormatPCM Format = "pcm"
	// FormatOpus outputs Opus encoded frames (for Discord voice UDP, 128kbps).
	FormatOpus Format = "opus"
	// FormatWeb outputs Opus encoded frames for browser playback (256kbps high quality).
	FormatWeb Format = "web"
)

// Config holds encoding configuration.
type Config struct {
	SampleRate int     // Sample rate in Hz (default: 48000)
	Channels   int     // Number of channels (default: 2 for stereo)
	Bitrate    int     // Bitrate in bps (default: 128000)
	Volume     float64 // Volume multiplier 0.0-2.0 (default: 1.0)
}

// DefaultConfig returns the default encoding configuration
// optimized for Discord audio quality.
func DefaultConfig() Config {
	return Config{
		SampleRate: 48000,
		Channels:   2,
		Bitrate:    256000, // 256kbps - best practical quality for Opus
		Volume:     1.0,
	}
}

// Pipeline represents an audio encoding pipeline.
// It extracts audio from a URL, decodes it, and encodes to Opus format.
type Pipeline interface {
	// Start begins the encoding pipeline for the given stream URL.
	// The format parameter determines the output format (pcm or raw).
	// Returns an error if the pipeline fails to start.
	Start(ctx context.Context, streamURL string, format Format, startAtSec float64) error

	// Output returns a channel that receives encoded audio chunks.
	// For FormatPCM: chunks are raw PCM s16le data (for ffplay).
	// For FormatOpus: chunks are Opus encoded frames (for Discord).
	// The channel is closed when the stream ends or Stop is called.
	Output() <-chan []byte

	// Pause pauses the pipeline (stops FFmpeg with SIGSTOP).
	Pause()

	// Resume resumes the pipeline (continues FFmpeg with SIGCONT).
	Resume()

	// Stop stops the encoding pipeline and releases resources.
	Stop()
}
