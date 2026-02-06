package youtube

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
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

const (
	defaultCookiesPath = "/app/secrets/youtube_cookies.txt"
	runtimeCookiesPath = "/tmp/yt-cookies.txt"
)

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
	cookiesFile := strings.TrimSpace(config.CookiesFile)
	if cookiesFile != "" {
		fmt.Printf("[YouTube] Using cookies file: %s\n", cookiesFile)
		return []string{"--cookies", prepareCookieFile(cookiesFile)}
	}

	cookiesFromBrowser := strings.TrimSpace(config.CookiesFromBrowser)
	if cookiesFromBrowser != "" {
		fmt.Printf("[YouTube] Using cookies from browser: %s\n", cookiesFromBrowser)
		return []string{"--cookies-from-browser", cookiesFromBrowser}
	}

	if _, err := os.Stat(defaultCookiesPath); err == nil {
		fmt.Printf("[YouTube] Using default cookies file: %s\n", defaultCookiesPath)
		return []string{"--cookies", prepareCookieFile(defaultCookiesPath)}
	}

	return nil
}

func prepareCookieFile(sourcePath string) string {
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return sourcePath
	}
	if err := os.WriteFile(runtimeCookiesPath, data, 0600); err != nil {
		return sourcePath
	}
	return runtimeCookiesPath
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

	args = append(args, getJsRuntimeArgs()...)

	// Add cookie args for authenticated access (better quality)
	args = append(args, getCookieArgs()...)

	// Try common audio format selectors first
	formatSelectors := []string{"bestaudio/best", "bestaudio", "best"}
	for _, selector := range formatSelectors {
		formatArgs := append(append([]string{}, args...), "-f", selector, "--get-url", youtubeURL)
		url, err := runYtDlpGetURL(formatArgs)
		if err == nil {
			return url, nil
		}
	}

	// Fallback: no format selector (may return multiple URLs)
	fallbackArgs := append(append([]string{}, args...), "--get-url", youtubeURL)
	url, err := runYtDlpGetURL(fallbackArgs)
	if err != nil {
		return "", err
	}
	return url, nil
}

func getJsRuntimeArgs() []string {
	if _, err := exec.LookPath("node"); err == nil {
		return []string{"--js-runtimes", "node"}
	}
	if _, err := exec.LookPath("deno"); err == nil {
		return []string{"--js-runtimes", "deno"}
	}
	return nil
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

	args = append(args, getJsRuntimeArgs()...)
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

	if meta.Thumbnail == "" {
		if videoID := extractYouTubeID(youtubeURL); videoID != "" {
			meta.Thumbnail = "https://i.ytimg.com/vi/" + videoID + "/mqdefault.jpg"
		}
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

	args = append(args, getJsRuntimeArgs()...)
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

func extractYouTubeID(value string) string {
	if isYouTubeID(value) {
		return value
	}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})`),
		regexp.MustCompile(`youtube\.com/.*[?&]v=([a-zA-Z0-9_-]{11})`),
	}
	for _, pattern := range patterns {
		match := pattern.FindStringSubmatch(value)
		if len(match) > 1 {
			return match[1]
		}
	}
	return ""
}

// SearchResult represents a single search result.
type SearchResult struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	Duration  int    `json:"duration"`
	Thumbnail string `json:"thumbnail"`
	Channel   string `json:"channel"`
}

// Search searches YouTube for videos matching the query.
func (e *Extractor) Search(query string, limit int) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 10 {
		limit = 10
	}

	searchQuery := fmt.Sprintf("ytsearch%d:%s", limit, query)

	args := []string{
		"--ignore-config",
		"--flat-playlist",
		"--no-warnings",
		"--no-check-certificate",
		"--socket-timeout", "10",
		"-j",
	}

	args = append(args, getJsRuntimeArgs()...)
	args = append(args, getCookieArgs()...)
	args = append(args, searchQuery)

	cmd := exec.Command("yt-dlp", args...)

	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp search failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	results := make([]SearchResult, 0, len(lines))

	for _, line := range lines {
		if line == "" {
			continue
		}
		var entry struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			Duration  int    `json:"duration"`
			Thumbnail string `json:"thumbnail"`
			Channel   string `json:"channel"`
			Uploader  string `json:"uploader"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		url := "https://www.youtube.com/watch?v=" + entry.ID

		thumbnail := entry.Thumbnail
		if thumbnail == "" && entry.ID != "" {
			thumbnail = "https://i.ytimg.com/vi/" + entry.ID + "/mqdefault.jpg"
		}

		channel := entry.Channel
		if channel == "" {
			channel = entry.Uploader
		}

		results = append(results, SearchResult{
			ID:        entry.ID,
			URL:       url,
			Title:     entry.Title,
			Duration:  entry.Duration,
			Thumbnail: thumbnail,
			Channel:   channel,
		})
	}

	return results, nil
}
