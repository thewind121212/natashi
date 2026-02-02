package youtube

import (
	"fmt"
	"os/exec"
	"strings"
)

// Extractor implements platform.StreamExtractor for YouTube.
// Single Responsibility: Only handles YouTube stream extraction.
type Extractor struct{}

// New creates a new YouTube extractor.
func New() *Extractor {
	return &Extractor{}
}

// Name returns the platform name.
func (e *Extractor) Name() string {
	return "youtube"
}

// CanHandle returns true if the URL is a YouTube URL.
func (e *Extractor) CanHandle(url string) bool {
	return strings.Contains(url, "youtube.com") ||
		strings.Contains(url, "youtu.be")
}

// ExtractStreamURL extracts the direct audio stream URL from a YouTube URL.
func (e *Extractor) ExtractStreamURL(youtubeURL string) (string, error) {
	cmd := exec.Command("yt-dlp",
		"--no-playlist",        // single video only
		"-f", "bestaudio/best", // best audio quality available
		"--get-url", // print direct stream URL only (no download)
		youtubeURL,
	)

	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("yt-dlp failed: %w", err)
	}

	url := strings.TrimSpace(string(out))
	if url == "" {
		return "", fmt.Errorf("yt-dlp returned empty URL")
	}
	return url, nil
}
