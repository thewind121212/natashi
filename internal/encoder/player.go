package encoder

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

// Player plays audio directly to macOS audio device.
type Player struct {
	config   Config
	cmd      *exec.Cmd
	cancel   context.CancelFunc
	mu       sync.Mutex
	playing  bool
	progress ProgressFunc
}

// ProgressFunc is called with playback progress.
type ProgressFunc func(elapsed time.Duration, bytes int64)

// NewPlayer creates a new audio player.
func NewPlayer(config Config) *Player {
	return &Player{config: config}
}

// NewDefaultPlayer creates a player with default config.
func NewDefaultPlayer() *Player {
	return NewPlayer(DefaultConfig())
}

// SetProgressCallback sets the progress callback.
func (p *Player) SetProgressCallback(fn ProgressFunc) {
	p.progress = fn
}

// Play starts playback to the default audio device.
func (p *Player) Play(ctx context.Context, streamURL string) error {
	p.mu.Lock()
	if p.playing {
		p.mu.Unlock()
		return fmt.Errorf("already playing")
	}
	p.playing = true
	p.mu.Unlock()

	ctx, p.cancel = context.WithCancel(ctx)
	defer func() {
		p.mu.Lock()
		p.playing = false
		p.mu.Unlock()
	}()

	args := p.buildArgs(streamURL)
	fmt.Printf("[Player] Starting FFmpeg: %v\n", args[:10]) // Print first 10 args
	p.cmd = exec.CommandContext(ctx, "ffmpeg", args...)

	// Capture stderr for progress
	stderr, err := p.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	// Discard stdout
	p.cmd.Stdout = nil

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}

	fmt.Printf("[Player] FFmpeg started, PID: %d\n", p.cmd.Process.Pid)

	// Read stderr in background (contains progress)
	go p.readProgress(stderr)

	// Wait for completion
	err = p.cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err() // Cancelled
	}
	if err != nil {
		return fmt.Errorf("ffmpeg error: %w", err)
	}

	fmt.Println("[Player] Playback finished")
	return nil
}

// Stop stops playback.
func (p *Player) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cancel != nil {
		p.cancel()
	}
	if p.cmd != nil && p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
}

// IsPlaying returns true if currently playing.
func (p *Player) IsPlaying() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.playing
}

func (p *Player) buildArgs(streamURL string) []string {
	volume := fmt.Sprintf("volume=%.2f", p.config.Volume)
	sampleRate := fmt.Sprintf("%d", p.config.SampleRate)
	channels := fmt.Sprintf("%d", p.config.Channels)

	args := []string{
		"-reconnect", "1",
		"-reconnect_streamed", "1",
		"-reconnect_delay_max", "5",
		"-i", streamURL,
		"-af", volume,
		"-ar", sampleRate,
		"-ac", channels,
		"-loglevel", "info",
	}

	// Platform-specific audio output
	switch runtime.GOOS {
	case "darwin":
		args = append(args, "-f", "audiotoolbox", "-")
	case "linux":
		args = append(args, "-f", "pulse", "default")
	default:
		args = append(args, "-f", "dshow", "audio=default")
	}

	return args
}

func (p *Player) readProgress(stderr io.ReadCloser) {
	defer stderr.Close()

	buf := make([]byte, 1024)
	for {
		n, err := stderr.Read(buf)
		if err != nil {
			return
		}
		if n > 0 {
			// FFmpeg outputs progress to stderr
			// Could parse "time=" from output for progress
			// For now just print it
			// fmt.Print(string(buf[:n]))
		}
	}
}
