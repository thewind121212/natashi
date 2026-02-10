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
	config         Config
	cmd            *exec.Cmd
	stdout         io.ReadCloser
	stderr         io.ReadCloser
	output         chan []byte
	cancel         context.CancelFunc
	readBufferSize int
	sessionID      string // For logging which session this pipeline belongs to
}

// NewFFmpegPipeline creates a new FFmpeg-based encoding pipeline.
func NewFFmpegPipeline(config Config) *FFmpegPipeline {
	return &FFmpegPipeline{
		config:         config,
		output:         make(chan []byte, 30), // Buffer ~600ms for smooth streaming without excessive latency
		readBufferSize: 16384,
	}
}

// NewDefaultPipeline creates a pipeline with default configuration.
func NewDefaultPipeline() *FFmpegPipeline {
	return NewFFmpegPipeline(DefaultConfig())
}

// SetSessionID sets the session ID for logging purposes.
func (p *FFmpegPipeline) SetSessionID(id string) {
	p.sessionID = id
}

func (p *FFmpegPipeline) shortSessionID() string {
	if len(p.sessionID) <= 8 {
		return p.sessionID
	}
	return p.sessionID[:8]
}

// Start begins the encoding pipeline.
func (p *FFmpegPipeline) Start(ctx context.Context, streamURL string, format Format, startAtSec float64) error {
	ctx, p.cancel = context.WithCancel(ctx)

	switch format {
	case FormatWeb, FormatOpus:
		p.readBufferSize = 4096
	default:
		p.readBufferSize = 16384
	}

	args := p.buildArgs(streamURL, format, startAtSec)
	fmt.Printf("[FFmpeg] [%s] Starting (format: %s)\n", p.shortSessionID(), format)
	p.cmd = exec.CommandContext(ctx, "ffmpeg", args...)

	var err error
	p.stdout, err = p.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Capture stderr for debugging - FFmpeg sends errors/warnings here
	p.stderr, err = p.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Log stderr in background (helps debug premature stream endings)
	go p.readStderr()

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
func (p *FFmpegPipeline) buildArgs(streamURL string, format Format, startAtSec float64) []string {
	volume := fmt.Sprintf("volume=%.2f", p.config.Volume)
	sampleRate := fmt.Sprintf("%d", p.config.SampleRate)
	channels := fmt.Sprintf("%d", p.config.Channels)

	// Base input args - robust reconnect for YouTube streams
	args := []string{
		"-reconnect", "1",
		"-reconnect_streamed", "1",
		"-reconnect_on_network_error", "1",
		"-reconnect_on_http_error", "4xx,5xx",
		"-reconnect_delay_max", "5",
		"-multiple_requests", "1",
		// HTTP headers to reduce YouTube CDN connection resets
		"-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		"-referer", "https://www.youtube.com/",
	}

	if startAtSec > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", startAtSec))
	}

	// Input
	args = append(args,
		"-i", streamURL,
		// Audio processing
		"-af", volume,
		"-ar", sampleRate,
		"-ac", channels,
		"-loglevel", "warning",
	)

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
		// Prepend -re to read input at native frame rate (prevents buffer overflow on long videos)
		args = append([]string{"-re"}, args...)
		args = append(args,
			"-c:a", "libopus",
			"-b:a", "128000", // 128kbps for Discord
			"-vbr", "on", // Variable bitrate for better quality
			"-compression_level", "10", // Max compression quality
			"-frame_duration", "20", // 20ms frames (Discord standard)
			"-application", "audio", // Optimize for music
			"-f", "ogg", // OGG container for proper page-level framing
			"-page_duration", "20000", // 20ms OGG pages (one Opus frame per page)
			"-flush_packets", "1", // Flush after each page for smooth delivery
			"pipe:1",
		)
	case FormatWeb:
		// Opus encoded for browser - 256kbps high quality
		// Prepend -re to read input at native frame rate (real-time streaming)
		args = append([]string{"-re"}, args...)
		args = append(args,
			"-c:a", "libopus",
			"-b:a", "256000", // 256kbps YouTube Premium quality
			"-vbr", "on", // Variable bitrate for better quality
			"-compression_level", "10", // Max compression quality
			"-frame_duration", "20", // 20ms frames
			"-application", "audio", // Optimize for music
			"-f", "ogg", // OGG container (same as -f opus but more explicit)
			"-page_duration", "20000", // 20ms OGG pages for low latency streaming
			"-flush_packets", "1", // Flush output immediately
			"pipe:1",
		)
	}

	return args
}

// readStderr reads FFmpeg stderr and logs any errors/warnings.
// This helps debug why streams end prematurely.
func (p *FFmpegPipeline) readStderr() {
	if p.stderr == nil {
		return
	}
	defer p.stderr.Close()

	buf := make([]byte, 4096)
	var accumulated []byte

	for {
		n, err := p.stderr.Read(buf)
		if n > 0 {
			accumulated = append(accumulated, buf[:n]...)
			// Log complete lines
			for {
				idx := -1
				for i, b := range accumulated {
					if b == '\n' {
						idx = i
						break
					}
				}
				if idx < 0 {
					break
				}
				line := string(accumulated[:idx])
				accumulated = accumulated[idx+1:]
				if len(line) > 0 {
					fmt.Printf("[FFmpeg] [%s] STDERR: %s\n", p.shortSessionID(), line)
				}
			}
		}
		if err != nil {
			// Log any remaining data
			if len(accumulated) > 0 {
				fmt.Printf("[FFmpeg] [%s] STDERR: %s\n", p.shortSessionID(), string(accumulated))
			}
			return
		}
	}
}

// readOutput reads from FFmpeg stdout and sends chunks to output channel.
func (p *FFmpegPipeline) readOutput(ctx context.Context) {
	defer close(p.output)
	defer p.stdout.Close()

	buf := make([]byte, p.readBufferSize)
	totalBytes := 0
	chunkCount := 0

	for {
		select {
		case <-ctx.Done():
			fmt.Printf("[FFmpeg] [%s] Stopped (context cancelled), total: %d bytes\n", p.shortSessionID(), totalBytes)
			p.waitAndLogExit()
			return
		default:
			n, err := p.stdout.Read(buf)
			if err != nil {
				if err != io.EOF {
					fmt.Printf("[FFmpeg] [%s] Read error: %v\n", p.shortSessionID(), err)
				}
				fmt.Printf("[FFmpeg] [%s] Stream ended, total: %d bytes in %d chunks\n", p.shortSessionID(), totalBytes, chunkCount)
				p.waitAndLogExit()
				return
			}
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				totalBytes += n
				chunkCount++
				select {
				case p.output <- chunk:
				case <-ctx.Done():
					return
				}
			}
		}
	}
}

// waitAndLogExit waits for FFmpeg to exit and logs the exit code.
func (p *FFmpegPipeline) waitAndLogExit() {
	if p.cmd == nil {
		return
	}
	err := p.cmd.Wait()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			fmt.Printf("[FFmpeg] [%s] Exited with code %d\n", p.shortSessionID(), exitErr.ExitCode())
		} else {
			fmt.Printf("[FFmpeg] [%s] Wait error: %v\n", p.shortSessionID(), err)
		}
	} else {
		fmt.Printf("[FFmpeg] [%s] Exited normally (code 0)\n", p.shortSessionID())
	}
}
