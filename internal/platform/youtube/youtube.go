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
	if config.CookiesFromBrowser != "" {
		return []string{"--cookies-from-browser", config.CookiesFromBrowser}
	}
	if config.CookiesFile != "" {
		return []string{"--cookies", config.CookiesFile}
	}
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
	return strings.Contains(url, "youtube.com") ||
		strings.Contains(url, "youtu.be")
}

// ExtractStreamURL extracts the direct audio stream URL from a YouTube URL.
func (e *Extractor) ExtractStreamURL(youtubeURL string) (string, error) {
	args := []string{
		"--no-playlist",          // single video only
		"--no-warnings",          // suppress warnings for speed
		"--no-check-certificate", // skip SSL verification (faster)
		"--socket-timeout", "10", // shorter timeout
		"-f", "bestaudio",        // best audio quality available
		"--get-url",              // print direct stream URL only
	}

	// Add cookie args for authenticated access (better quality)
	args = append(args, getCookieArgs()...)
	args = append(args, youtubeURL)

	cmd := exec.Command("yt-dlp", args...)

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

// Metadata holds the JSON output from yt-dlp.
type Metadata struct {
	Title     string `json:"title"`
	Duration  int    `json:"duration"`
	Thumbnail string `json:"thumbnail"`
}

// ExtractMetadata extracts track metadata without downloading.
func (e *Extractor) ExtractMetadata(youtubeURL string) (*Metadata, error) {
	args := []string{
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

	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp metadata failed: %w", err)
	}

	var meta Metadata
	if err := json.Unmarshal(out, &meta); err != nil {
		return nil, fmt.Errorf("failed to parse metadata: %w", err)
	}

	return &meta, nil
}

// IsPlaylist checks if the URL is a YouTube playlist.
func (e *Extractor) IsPlaylist(youtubeURL string) bool {
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
	args := []string{
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

	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp playlist failed: %w", err)
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
