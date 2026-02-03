package server

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
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
	URL    string `json:"url" binding:"required"`
	Format string `json:"format"`
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
	err := a.sessions.StartPlayback(sessionID, req.URL, format)
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
