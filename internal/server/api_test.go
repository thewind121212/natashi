package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestRouter() (*gin.Engine, *SessionManager) {
	ctx := context.Background()
	sessions := NewSessionManager(ctx)
	api := NewAPI(sessions)

	router := gin.New()
	router.POST("/session/:id/play", api.Play)
	router.POST("/session/:id/stop", api.Stop)
	router.POST("/session/:id/pause", api.Pause)
	router.POST("/session/:id/resume", api.Resume)
	router.GET("/session/:id/status", api.Status)
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	return router, sessions
}

func TestHealthEndpoint(t *testing.T) {
	router, _ := setupTestRouter()

	req, _ := http.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["status"] != "ok" {
		t.Errorf("expected status ok, got %s", resp["status"])
	}
}

func TestPlayEndpoint_ValidRequest(t *testing.T) {
	router, _ := setupTestRouter()

	// Valid play request - will fail because URL is not real YouTube, but tests request parsing
	body := `{"url": "https://youtube.com/watch?v=test"}`
	req, _ := http.NewRequest("POST", "/session/test-session/play", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Should return 200 because request is valid (playback starts async)
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp PlayResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Status != "playing" {
		t.Errorf("expected status playing, got %s", resp.Status)
	}
}

func TestPlayEndpoint_MissingURL(t *testing.T) {
	router, _ := setupTestRouter()

	body := `{}`
	req, _ := http.NewRequest("POST", "/session/test-session/play", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var resp PlayResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Status != "error" {
		t.Errorf("expected status error, got %s", resp.Status)
	}
}

func TestPlayEndpoint_InvalidJSON(t *testing.T) {
	router, _ := setupTestRouter()

	body := `{invalid json}`
	req, _ := http.NewRequest("POST", "/session/test-session/play", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestStopEndpoint(t *testing.T) {
	router, _ := setupTestRouter()

	req, _ := http.NewRequest("POST", "/session/test-session/stop", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp PlayResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Status != "stopped" {
		t.Errorf("expected status stopped, got %s", resp.Status)
	}
	if resp.SessionID != "test-session" {
		t.Errorf("expected session_id test-session, got %s", resp.SessionID)
	}
}

func TestPauseEndpoint_NoSession(t *testing.T) {
	router, _ := setupTestRouter()

	req, _ := http.NewRequest("POST", "/session/nonexistent/pause", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestResumeEndpoint_NoSession(t *testing.T) {
	router, _ := setupTestRouter()

	req, _ := http.NewRequest("POST", "/session/nonexistent/resume", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestStatusEndpoint_NoSession(t *testing.T) {
	router, _ := setupTestRouter()

	req, _ := http.NewRequest("GET", "/session/nonexistent/status", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}

	var resp StatusResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Status != "not_found" {
		t.Errorf("expected status not_found, got %s", resp.Status)
	}
}

func TestSessionState_String(t *testing.T) {
	tests := []struct {
		state    SessionState
		expected string
	}{
		{StateIdle, "idle"},
		{StateExtracting, "extracting"},
		{StateStreaming, "streaming"},
		{StatePaused, "paused"},
		{StateStopped, "stopped"},
		{StateError, "error"},
		{SessionState(99), "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := tt.state.String(); got != tt.expected {
				t.Errorf("SessionState.String() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestMetadataEndpoint_MissingURL(t *testing.T) {
	router, _ := setupTestRouter()
	api := NewAPI(NewSessionManager(context.Background()))
	router.GET("/metadata", api.Metadata)

	req, _ := http.NewRequest("GET", "/metadata", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestPlaylistEndpoint_MissingURL(t *testing.T) {
	router, _ := setupTestRouter()
	api := NewAPI(NewSessionManager(context.Background()))
	router.GET("/playlist", api.Playlist)

	req, _ := http.NewRequest("GET", "/playlist", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}
