package server

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"music-bot/internal/platform/youtube"
)

// API handles HTTP control endpoints.
type API struct {
	sessions *SessionManager
}

// NewAPI creates a new API handler.
func NewAPI(sessions *SessionManager) *API {
	return &API{
		sessions: sessions,
	}
}

// PlayRequest is the request body for play endpoint.
type PlayRequest struct {
	URL     string  `json:"url" binding:"required"`
	Format  string  `json:"format"`
	StartAt float64 `json:"start_at"`
}

// PlayResponse is the response for play endpoint.
type PlayResponse struct {
	Status    string `json:"status"`
	SessionID string `json:"session_id"`
	Message   string `json:"message,omitempty"`
}

// StatusResponse is the response for status endpoint.
type StatusResponse struct {
	SessionID string `json:"session_id"`
	Status    string `json:"status"`
	BytesSent int64  `json:"bytes_sent"`
	URL       string `json:"url,omitempty"`
}

// MetadataResponse is the response for metadata endpoint.
type MetadataResponse struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	Duration   int    `json:"duration"`
	Thumbnail  string `json:"thumbnail"`
	IsPlaylist bool   `json:"is_playlist"`
	Error      string `json:"error,omitempty"`
}

// PlaylistEntry represents a video in a playlist.
type PlaylistEntry struct {
	URL       string `json:"url"`
	Title     string `json:"title"`
	Duration  int    `json:"duration"`
	Thumbnail string `json:"thumbnail"`
}

// PlaylistResponse is the response for playlist endpoint.
type PlaylistResponse struct {
	URL     string          `json:"url"`
	Count   int             `json:"count"`
	Entries []PlaylistEntry `json:"entries"`
	Error   string          `json:"error,omitempty"`
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

// SearchResponse is the response for search endpoint.
type SearchResponse struct {
	Query   string         `json:"query"`
	Count   int            `json:"count"`
	Results []SearchResult `json:"results"`
	Error   string         `json:"error,omitempty"`
}

// Play starts a new playback session.
func (a *API) Play(c *gin.Context) {
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, PlayResponse{
			Status:  "error",
			Message: "session_id is required",
		})
		return
	}

	var req PlayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, PlayResponse{
			Status:    "error",
			SessionID: sessionID,
			Message:   fmt.Sprintf("invalid request: %v", err),
		})
		return
	}

	format := req.Format
	if format == "" {
		format = "pcm"
	}

	fmt.Printf("[API] Play request: session=%s url=%s format=%s\n", sessionID, req.URL, format)

	// Start playback (this is non-blocking now)
	err := a.sessions.StartPlayback(sessionID, req.URL, format, req.StartAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, PlayResponse{
			Status:    "error",
			SessionID: sessionID,
			Message:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, PlayResponse{
		Status:    "playing",
		SessionID: sessionID,
	})
}

// Stop stops a playback session.
func (a *API) Stop(c *gin.Context) {
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, PlayResponse{
			Status:  "error",
			Message: "session_id is required",
		})
		return
	}

	fmt.Printf("[API] Stop request: session=%s\n", sessionID)

	a.sessions.Stop(sessionID)

	c.JSON(http.StatusOK, PlayResponse{
		Status:    "stopped",
		SessionID: sessionID,
	})
}

// Pause pauses a playback session.
func (a *API) Pause(c *gin.Context) {
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, PlayResponse{
			Status:  "error",
			Message: "session_id is required",
		})
		return
	}

	fmt.Printf("[API] Pause request: session=%s\n", sessionID)

	err := a.sessions.Pause(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, PlayResponse{
			Status:    "error",
			SessionID: sessionID,
			Message:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, PlayResponse{
		Status:    "paused",
		SessionID: sessionID,
	})
}

// Resume resumes a paused playback session.
func (a *API) Resume(c *gin.Context) {
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, PlayResponse{
			Status:  "error",
			Message: "session_id is required",
		})
		return
	}

	fmt.Printf("[API] Resume request: session=%s\n", sessionID)

	err := a.sessions.Resume(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, PlayResponse{
			Status:    "error",
			SessionID: sessionID,
			Message:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, PlayResponse{
		Status:    "playing",
		SessionID: sessionID,
	})
}

// Status returns the status of a playback session.
func (a *API) Status(c *gin.Context) {
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, StatusResponse{
			Status: "error",
		})
		return
	}

	session := a.sessions.Get(sessionID)
	if session == nil {
		c.JSON(http.StatusNotFound, StatusResponse{
			SessionID: sessionID,
			Status:    "not_found",
		})
		return
	}

	c.JSON(http.StatusOK, StatusResponse{
		SessionID: sessionID,
		Status:    session.GetStateString(),
		BytesSent: session.BytesSent,
		URL:       session.URL,
	})
}

// Metadata extracts track metadata without starting playback.
func (a *API) Metadata(c *gin.Context) {
	url := c.Query("url")
	if url == "" {
		c.JSON(http.StatusBadRequest, MetadataResponse{
			Error: "url query parameter is required",
		})
		return
	}

	fmt.Printf("[API] Metadata request: url=%s\n", url)

	extractor := youtube.New()
	if !extractor.CanHandle(url) {
		c.JSON(http.StatusBadRequest, MetadataResponse{
			URL:   url,
			Error: "unsupported URL (only YouTube supported)",
		})
		return
	}

	// Check if it's a playlist
	isPlaylist := extractor.IsPlaylist(url)

	meta, err := extractor.ExtractMetadata(url)
	if err != nil {
		c.JSON(http.StatusInternalServerError, MetadataResponse{
			URL:   url,
			Error: fmt.Sprintf("failed to extract metadata: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, MetadataResponse{
		URL:        url,
		Title:      meta.Title,
		Duration:   meta.Duration,
		Thumbnail:  meta.Thumbnail,
		IsPlaylist: isPlaylist,
	})
}

// Playlist extracts all videos from a YouTube playlist.
func (a *API) Playlist(c *gin.Context) {
	url := c.Query("url")
	if url == "" {
		c.JSON(http.StatusBadRequest, PlaylistResponse{
			Error: "url query parameter is required",
		})
		return
	}

	fmt.Printf("[API] Playlist request: url=%s\n", url)

	extractor := youtube.New()
	if !extractor.CanHandle(url) {
		c.JSON(http.StatusBadRequest, PlaylistResponse{
			URL:   url,
			Error: "unsupported URL (only YouTube supported)",
		})
		return
	}

	if !extractor.IsPlaylist(url) {
		c.JSON(http.StatusBadRequest, PlaylistResponse{
			URL:   url,
			Error: "URL is not a playlist",
		})
		return
	}

	entries, err := extractor.ExtractPlaylist(url)
	if err != nil {
		c.JSON(http.StatusInternalServerError, PlaylistResponse{
			URL:   url,
			Error: fmt.Sprintf("failed to extract playlist: %v", err),
		})
		return
	}

	// Convert to API response type
	apiEntries := make([]PlaylistEntry, len(entries))
	for i, e := range entries {
		apiEntries[i] = PlaylistEntry{
			URL:       e.URL,
			Title:     e.Title,
			Duration:  e.Duration,
			Thumbnail: e.Thumbnail,
		}
	}

	c.JSON(http.StatusOK, PlaylistResponse{
		URL:     url,
		Count:   len(apiEntries),
		Entries: apiEntries,
	})
}

// Search searches YouTube for videos matching the query.
func (a *API) Search(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, SearchResponse{
			Error: "q query parameter is required",
		})
		return
	}

	fmt.Printf("[API] Search request: q=%s\n", query)

	extractor := youtube.New()

	results, err := extractor.Search(query, 5)
	if err != nil {
		c.JSON(http.StatusInternalServerError, SearchResponse{
			Query: query,
			Error: fmt.Sprintf("search failed: %v", err),
		})
		return
	}

	// Convert to API response type
	apiResults := make([]SearchResult, len(results))
	for i, r := range results {
		apiResults[i] = SearchResult{
			ID:        r.ID,
			URL:       r.URL,
			Title:     r.Title,
			Duration:  r.Duration,
			Thumbnail: r.Thumbnail,
			Channel:   r.Channel,
		}
	}

	c.JSON(http.StatusOK, SearchResponse{
		Query:   query,
		Count:   len(apiResults),
		Results: apiResults,
	})
}
