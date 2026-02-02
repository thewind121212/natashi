package encoder

import (
	"context"
	"fmt"
	"io"
	"os/exec"
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
		output: make(chan []byte, 100),
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

// buildArgs constructs FFmpeg command arguments based on format.
func (p *FFmpegPipeline) buildArgs(streamURL string, format Format) []string {
	volume := fmt.Sprintf("volume=%.2f", p.config.Volume)
	sampleRate := fmt.Sprintf("%d", p.config.SampleRate)
	channels := fmt.Sprintf("%d", p.config.Channels)

	// Base input args with real-time streaming (like Lavalink)
	args := []string{
		// Low-latency input flags (MUST be before -i)
		"-fflags", "nobuffer",          // disable input buffering
		"-flags", "low_delay",          // enable low delay mode
		"-probesize", "32",             // minimal probe size for faster start
		"-analyzeduration", "0",        // skip duration analysis
		// Reconnect support
		"-reconnect", "1",
		"-reconnect_streamed", "1",
		"-reconnect_delay_max", "5",
		// CRITICAL: Read at real-time speed, not max speed
		"-re",                          // real-time input (stream, don't download all)
		"-i", streamURL,
		"-af", volume,
		"-ar", sampleRate,
		"-ac", channels,
		"-loglevel", "warning",
	}

	switch format {
	case FormatPCM:
		// Raw PCM output (s16le) - for debug playback
		args = append(args,
			"-f", "s16le",
			"pipe:1",
		)
	case FormatRaw:
		// Raw Opus frames - for Discord (future)
		args = append(args,
			"-c:a", "libopus",
			"-b:a", fmt.Sprintf("%d", p.config.Bitrate),
			"-f", "opus",
			"pipe:1",
		)
	case FormatWebM:
		// WebM container - for browser (not used now)
		args = append(args,
			"-c:a", "libopus",
			"-b:a", fmt.Sprintf("%d", p.config.Bitrate),
			"-f", "webm",
			"pipe:1",
		)
	}

	return args
}

// readOutput reads from FFmpeg stdout and sends chunks to output channel.
func (p *FFmpegPipeline) readOutput(ctx context.Context) {
	defer close(p.output)
	defer p.stdout.Close()

	buf := make([]byte, 4096)
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
