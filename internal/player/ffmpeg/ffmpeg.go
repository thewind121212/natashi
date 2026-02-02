package ffmpeg

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"

	"music-bot/internal/player"
)

// Player implements player.AudioPlayer using FFmpeg.
// Single Responsibility: Only handles audio playback via FFmpeg.
type Player struct {
	config player.Config
}

// New creates a new FFmpeg player with the given configuration.
func New(config player.Config) *Player {
	return &Player{config: config}
}

// NewDefault creates a new FFmpeg player with default configuration.
func NewDefault() *Player {
	return New(player.DefaultConfig())
}

// Name returns the player implementation name.
func (p *Player) Name() string {
	return "ffmpeg"
}

// Play starts playing the audio from the given stream URL.
func (p *Player) Play(ctx context.Context, streamURL string) error {
	cmd := p.buildCommand(streamURL)
	cmd.Stderr = os.Stderr // show ffmpeg progress in terminal

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe failed: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("FFmpeg failed to start: %w", err)
	}

	fmt.Printf("[INFO] FFmpeg running (PID: %d)\n", cmd.Process.Pid)

	// Drain stdout to prevent pipe blocking
	go io.Copy(io.Discard, stdout)

	// Wait for either context cancellation or command completion
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-ctx.Done():
		fmt.Println("\n[INFO] Stopping...")
		cmd.Process.Kill()
		fmt.Println("[INFO] Done.")
		return ctx.Err()
	case err := <-done:
		if err != nil {
			return fmt.Errorf("FFmpeg exited: %w", err)
		}
		fmt.Println("[INFO] Playback finished.")
		return nil
	}
}

// buildCommand creates the FFmpeg command based on the current OS.
func (p *Player) buildCommand(streamURL string) *exec.Cmd {
	channels := fmt.Sprintf("%d", p.config.Channels)
	sampleRate := fmt.Sprintf("%d", p.config.SampleRate)
	device := p.config.Device

	switch runtime.GOOS {
	case "linux":
		// PulseAudio (most modern Linux)
		return exec.Command("ffmpeg",
			"-i", streamURL,
			"-f", "pulse",
			"-ac", channels,
			"-ar", sampleRate,
			device,
		)

	case "darwin":
		// macOS AudioToolbox
		return exec.Command("ffmpeg",
			"-i", streamURL,
			"-f", "audiotoolbox",
			"-ac", channels,
			"-ar", sampleRate,
			device,
		)

	default: // windows
		// DirectSound - default audio device
		return exec.Command("ffmpeg",
			"-i", streamURL,
			"-f", "dshow",
			"-ac", channels,
			"-ar", sampleRate,
			"audio=@device_pk_{00000000-0000-0000-0000-000000000000}",
		)
	}
}
