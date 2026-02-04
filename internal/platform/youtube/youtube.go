package youtube

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Config holds YouTube extractor configuration.
type Config struct {
	// CookiesFromBrowser extracts cookies from browser (e.g., "firefox", "chrome", "safari")
	CookiesFromBrowser string
	// CookiesFile path to cookies.txt file (alternative to browser cookies)
	CookiesFile string
}

var config Config

// SetConfig sets the YouTube extractor configuration.
func SetConfig(c Config) {
	config = c
}

// LoadConfigFromEnv loads configuration from environment variables.
func LoadConfigFromEnv() {
	config.CookiesFromBrowser = os.Getenv("YT_COOKIES_BROWSER")
	config.CookiesFile = os.Getenv("YT_COOKIES_FILE")
}

// getCookieArgs returns yt-dlp arguments for cookie authentication.
func getCookieArgs() []string {
	return nil
}

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
	trimmed := strings.TrimSpace(url)
	if trimmed == "" {
		return false
	}
	if strings.Contains(trimmed, "youtube.com") || strings.Contains(trimmed, "youtu.be") {
		return true
	}
	return isYouTubeID(trimmed)
}

// ExtractStreamURL extracts the direct audio stream URL from a YouTube URL.
func (e *Extractor) ExtractStreamURL(youtubeURL string) (string, error) {
	youtubeURL = normalizeYouTubeURL(youtubeURL)
	args := []string{
		"--ignore-config",
		"--no-playlist",          // single video only
		"--no-warnings",          // suppress warnings for speed
		"--no-check-certificate", // skip SSL verification (faster)
		"--socket-timeout", "10", // shorter timeout
	}

	// Add cookie args for authenticated access (better quality)
	args = append(args, getCookieArgs()...)

	// Try bestaudio first (single URL)
	primaryArgs := append(append([]string{}, args...), "-f", "bestaudio", "--get-url", youtubeURL)
	url, err := runYtDlpGetURL(primaryArgs)
	if err == nil {
		return url, nil
	}

	// Fallback: no format selector (may return multiple URLs)
	fallbackArgs := append(append([]string{}, args...), "--get-url", youtubeURL)
	url, err = runYtDlpGetURL(fallbackArgs)
	if err != nil {
		return "", err
	}
	return url, nil
}

// Metadata holds the JSON output from yt-dlp.
type Metadata struct {
	Title     string `json:"title"`
	Duration  int    `json:"duration"`
	Thumbnail string `json:"thumbnail"`
}

// ExtractMetadata extracts track metadata without downloading.
func (e *Extractor) ExtractMetadata(youtubeURL string) (*Metadata, error) {
	youtubeURL = normalizeYouTubeURL(youtubeURL)
	args := []string{
		"--ignore-config",
		"--no-playlist",
		"--no-warnings",
		"--no-check-certificate",
		"--socket-timeout", "10",
		"-j", // JSON output
		"--skip-download",
	}

	args = append(args, getCookieArgs()...)
	args = append(args, youtubeURL)

	cmd := exec.Command("yt-dlp", args...)

	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp metadata failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	var meta Metadata
	if err := json.Unmarshal(out, &meta); err != nil {
		return nil, fmt.Errorf("failed to parse metadata: %w", err)
	}

	return &meta, nil
}

// IsPlaylist checks if the URL is a YouTube playlist.
func (e *Extractor) IsPlaylist(youtubeURL string) bool {
	youtubeURL = normalizeYouTubeURL(youtubeURL)
	return strings.Contains(youtubeURL, "list=")
}

// PlaylistEntry represents a single video in a playlist.
type PlaylistEntry struct {
	URL       string `json:"url"`
	Title     string `json:"title"`
	Duration  int    `json:"duration"`
	Thumbnail string `json:"thumbnail"`
}

// ExtractPlaylist extracts all videos from a YouTube playlist.
func (e *Extractor) ExtractPlaylist(playlistURL string) ([]PlaylistEntry, error) {
	playlistURL = normalizeYouTubeURL(playlistURL)
	args := []string{
		"--ignore-config",
		"--yes-playlist",
		"--flat-playlist", // Don't download, just list
		"--no-warnings",
		"--no-check-certificate",
		"--socket-timeout", "15",
		"-j", // JSON output per entry
	}

	args = append(args, getCookieArgs()...)
	args = append(args, playlistURL)

	cmd := exec.Command("yt-dlp", args...)

	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp playlist failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	// yt-dlp outputs one JSON per line for flat-playlist
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	entries := make([]PlaylistEntry, 0, len(lines))

	for _, line := range lines {
		if line == "" {
			continue
		}
		var entry struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			Duration  int    `json:"duration"`
			Thumbnail string `json:"thumbnail"`
			URL       string `json:"url"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue // Skip malformed entries
		}

		// Build full URL if only ID provided
		url := entry.URL
		if url == "" && entry.ID != "" {
			url = "https://www.youtube.com/watch?v=" + entry.ID
		}

		// Build thumbnail URL from video ID if not provided
		// YouTube thumbnails have predictable URLs: https://i.ytimg.com/vi/{ID}/mqdefault.jpg
		thumbnail := entry.Thumbnail
		if thumbnail == "" && entry.ID != "" {
			thumbnail = "https://i.ytimg.com/vi/" + entry.ID + "/mqdefault.jpg"
		}

		entries = append(entries, PlaylistEntry{
			URL:       url,
			Title:     entry.Title,
			Duration:  entry.Duration,
			Thumbnail: thumbnail,
		})
	}

	if len(entries) == 0 {
		return nil, fmt.Errorf("no videos found in playlist")
	}

	return entries, nil
}

func runYtDlpGetURL(args []string) (string, error) {
	cmd := exec.Command("yt-dlp", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("yt-dlp failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 0 {
		return "", fmt.Errorf("yt-dlp returned empty URL")
	}

	// Prefer audio-only URL when multiple URLs are returned
	for _, line := range lines {
		if strings.Contains(line, "mime=audio") || strings.Contains(line, "audio/") {
			return strings.TrimSpace(line), nil
		}
	}

	return strings.TrimSpace(lines[0]), nil
}

func isYouTubeID(value string) bool {
	if len(value) != 11 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func normalizeYouTubeURL(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return trimmed
	}
	if strings.Contains(trimmed, "youtube.com") || strings.Contains(trimmed, "youtu.be") {
		return trimmed
	}
	if isYouTubeID(trimmed) {
		return "https://www.youtube.com/watch?v=" + trimmed
	}
	return trimmed
}
