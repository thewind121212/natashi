package encoder

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"syscall"
)

// FFmpegPipeline implements Pipeline using FFmpeg for decoding and encoding.
type FFmpegPipeline struct {
	config Config
	cmd    *exec.Cmd
	stdout io.ReadCloser
	output chan []byte
	cancel context.CancelFunc
}

// NewFFmpegPipeline creates a new FFmpeg-based encoding pipeline.
func NewFFmpegPipeline(config Config) *FFmpegPipeline {
	return &FFmpegPipeline{
		config: config,
		output: make(chan []byte, 10), // Small buffer (~200ms) for low latency
	}
}

// NewDefaultPipeline creates a pipeline with default configuration.
func NewDefaultPipeline() *FFmpegPipeline {
	return NewFFmpegPipeline(DefaultConfig())
}

// Start begins the encoding pipeline.
func (p *FFmpegPipeline) Start(ctx context.Context, streamURL string, format Format) error {
	ctx, p.cancel = context.WithCancel(ctx)

	args := p.buildArgs(streamURL, format)
	fmt.Printf("[FFmpeg] Starting with format: %s\n", format)
	p.cmd = exec.CommandContext(ctx, "ffmpeg", args...)

	var err error
	p.stdout, err = p.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	fmt.Printf("[FFmpeg] Started with PID %d\n", p.cmd.Process.Pid)

	go p.readOutput(ctx)

	return nil
}

// Output returns the channel receiving encoded audio chunks.
func (p *FFmpegPipeline) Output() <-chan []byte {
	return p.output
}

// Stop stops the encoding pipeline.
func (p *FFmpegPipeline) Stop() {
	if p.cancel != nil {
		p.cancel()
	}
	if p.cmd != nil && p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
}

// Pause pauses FFmpeg using SIGSTOP and drains buffered output.
func (p *FFmpegPipeline) Pause() {
	if p.cmd != nil && p.cmd.Process != nil {
		// Send SIGSTOP to pause FFmpeg process
		p.cmd.Process.Signal(syscall.SIGSTOP)
		fmt.Printf("[FFmpeg] Paused (SIGSTOP) PID %d\n", p.cmd.Process.Pid)

		// Drain any buffered chunks to prevent stale audio on resume
		drained := 0
		for {
			select {
			case <-p.output:
				drained++
			default:
				if drained > 0 {
					fmt.Printf("[FFmpeg] Drained %d buffered chunks\n", drained)
				}
				return
			}
		}
	}
}

// Resume resumes FFmpeg using SIGCONT.
func (p *FFmpegPipeline) Resume() {
	if p.cmd != nil && p.cmd.Process != nil {
		// Drain any remaining buffered chunks first
		drained := 0
		for {
			select {
			case <-p.output:
				drained++
			default:
				goto done
			}
		}
	done:
		if drained > 0 {
			fmt.Printf("[FFmpeg] Drained %d stale chunks before resume\n", drained)
		}

		// Send SIGCONT to resume FFmpeg process
		p.cmd.Process.Signal(syscall.SIGCONT)
		fmt.Printf("[FFmpeg] Resumed (SIGCONT) PID %d\n", p.cmd.Process.Pid)
	}
}

// buildArgs constructs FFmpeg command arguments based on format.
func (p *FFmpegPipeline) buildArgs(streamURL string, format Format) []string {
	volume := fmt.Sprintf("volume=%.2f", p.config.Volume)
	sampleRate := fmt.Sprintf("%d", p.config.SampleRate)
	channels := fmt.Sprintf("%d", p.config.Channels)

	// Base input args - buffer ahead for smooth playback
	args := []string{
		// Reconnect support for network streams
		"-reconnect", "1",
		"-reconnect_streamed", "1",
		"-reconnect_delay_max", "5",
		// Input
		"-i", streamURL,
		// Audio processing
		"-af", volume,
		"-ar", sampleRate,
		"-ac", channels,
		"-loglevel", "warning",
	}

	switch format {
	case FormatPCM:
		// Raw PCM output (s16le) - for debug playback
		// Prepend -re to read input at native frame rate (real-time streaming)
		args = append([]string{"-re"}, args...)
		args = append(args,
			"-f", "s16le",
			"pipe:1",
		)
	case FormatOpus:
		// Opus encoded for Discord - 128kbps for voice channels
		args = append(args,
			"-c:a", "libopus",
			"-b:a", "128000",            // 128kbps for Discord
			"-vbr", "on",                // Variable bitrate for better quality
			"-compression_level", "10",  // Max compression quality
			"-frame_duration", "20",     // 20ms frames (Discord standard)
			"-application", "audio",     // Optimize for music
			"-f", "opus",
			"pipe:1",
		)
	case FormatWeb:
		// Opus encoded for browser - 256kbps high quality
		// Prepend -re to read input at native frame rate (real-time streaming)
		args = append([]string{"-re"}, args...)
		args = append(args,
			"-c:a", "libopus",
			"-b:a", "256000",            // 256kbps YouTube Premium quality
			"-vbr", "on",                // Variable bitrate for better quality
			"-compression_level", "10",  // Max compression quality
			"-frame_duration", "20",     // 20ms frames
			"-application", "audio",     // Optimize for music
			"-f", "ogg",                 // OGG container (same as -f opus but more explicit)
			"-page_duration", "20000",   // 20ms OGG pages for low latency streaming
			"-flush_packets", "1",       // Flush output immediately
			"pipe:1",
		)
	}

	return args
}

// readOutput reads from FFmpeg stdout and sends chunks to output channel.
func (p *FFmpegPipeline) readOutput(ctx context.Context) {
	defer close(p.output)
	defer p.stdout.Close()

	buf := make([]byte, 16384) // Larger buffer for smoother streaming
	totalBytes := 0
	chunkCount := 0

	for {
		select {
		case <-ctx.Done():
			fmt.Printf("[FFmpeg] Stopped, total: %d bytes\n", totalBytes)
			return
		default:
			n, err := p.stdout.Read(buf)
			if err != nil {
				if err != io.EOF {
					fmt.Printf("[FFmpeg] Read error: %v\n", err)
				}
				fmt.Printf("[FFmpeg] Stream ended, total: %d bytes in %d chunks\n", totalBytes, chunkCount)
				return
			}
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				totalBytes += n
				chunkCount++
				if chunkCount%500 == 1 {
					fmt.Printf("[FFmpeg] Progress: %d KB\n", totalBytes/1024)
				}
				select {
				case p.output <- chunk:
				case <-ctx.Done():
					return
				}
			}
		}
	}
}
