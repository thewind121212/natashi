package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"

	"music-bot/internal/encoder"
	"music-bot/internal/platform"
	"music-bot/internal/platform/youtube"
)

// SessionState represents the current state of a session.
type SessionState int

const (
	StateIdle SessionState = iota
	StateExtracting
	StateStreaming
	StatePaused
	StateStopped
	StateError
)

// String returns the string representation of the state.
func (s SessionState) String() string {
	switch s {
	case StateIdle:
		return "idle"
	case StateExtracting:
		return "extracting"
	case StateStreaming:
		return "streaming"
	case StatePaused:
		return "paused"
	case StateStopped:
		return "stopped"
	case StateError:
		return "error"
	default:
		return "unknown"
	}
}

// Session represents an active audio playback session.
type Session struct {
	ID        string
	State     SessionState
	URL       string
	Format    encoder.Format
	Pipeline  encoder.Pipeline
	Cancel    context.CancelFunc
	BytesSent int64
	isPaused  bool
	pauseCh   chan struct{} // Signal to pause
	resumeCh  chan struct{} // Signal to resume
	mu        sync.Mutex
}

// SessionManager manages active playback sessions.
type SessionManager struct {
	sessions map[string]*Session
	registry *platform.Registry
	conn     net.Conn // Current socket connection for audio output
	connMu   sync.Mutex
	ctx      context.Context
	mu       sync.RWMutex
}

// NewSessionManager creates a new session manager.
func NewSessionManager(ctx context.Context) *SessionManager {
	registry := platform.NewRegistry()
	registry.Register(youtube.New())

	return &SessionManager{
		sessions: make(map[string]*Session),
		registry: registry,
		ctx:      ctx,
	}
}

// SetConnection sets the socket connection for audio output.
func (m *SessionManager) SetConnection(conn net.Conn) {
	m.connMu.Lock()
	defer m.connMu.Unlock()
	m.conn = conn
}

// GetConnection returns the current socket connection.
func (m *SessionManager) GetConnection() net.Conn {
	m.connMu.Lock()
	defer m.connMu.Unlock()
	return m.conn
}

// StartPlayback starts a new playback session (non-blocking).
func (m *SessionManager) StartPlayback(id string, url string, formatStr string) error {
	m.mu.Lock()

	// Stop existing session with same ID if any
	if existing, ok := m.sessions[id]; ok {
		existing.Stop()
		delete(m.sessions, id)
	}

	// Determine format
	format := encoder.FormatPCM
	if formatStr == "raw" {
		format = encoder.FormatRaw
	} else if formatStr == "webm" {
		format = encoder.FormatWebM
	}

	session := &Session{
		ID:       id,
		State:    StateIdle,
		URL:      url,
		Format:   format,
		pauseCh:  make(chan struct{}, 1),
		resumeCh: make(chan struct{}, 1),
	}
	m.sessions[id] = session
	m.mu.Unlock()

	// Start playback in goroutine (non-blocking)
	go m.runPlayback(session)

	return nil
}

// runPlayback runs the playback pipeline for a session.
func (m *SessionManager) runPlayback(session *Session) {
	session.SetState(StateExtracting)
	fmt.Printf("[Session] Starting playback for %s\n", session.ID[:8])

	// Find extractor for URL
	extractor := m.registry.FindExtractor(session.URL)
	if extractor == nil {
		session.SetState(StateError)
		m.sendEvent(session.ID, "error", "unsupported URL")
		return
	}

	// Extract stream URL
	fmt.Println("[Session] Extracting stream URL...")
	streamURL, err := extractor.ExtractStreamURL(session.URL)
	if err != nil {
		session.SetState(StateError)
		m.sendEvent(session.ID, "error", fmt.Sprintf("extraction failed: %v", err))
		return
	}
	fmt.Printf("[Session] Stream URL extracted (length: %d)\n", len(streamURL))

	// Create encoding pipeline
	pipeline := encoder.NewDefaultPipeline()
	session.mu.Lock()
	session.Pipeline = pipeline
	session.mu.Unlock()

	// Create cancellable context for this session
	sessionCtx, cancel := context.WithCancel(m.ctx)
	session.mu.Lock()
	session.Cancel = cancel
	session.mu.Unlock()

	// Start pipeline
	fmt.Println("[Session] Starting encoding pipeline...")
	if err := pipeline.Start(sessionCtx, streamURL, session.Format); err != nil {
		session.SetState(StateError)
		m.sendEvent(session.ID, "error", fmt.Sprintf("pipeline failed: %v", err))
		return
	}

	session.SetState(StateStreaming)
	m.sendEvent(session.ID, "ready", "")

	// Stream audio data
	m.streamAudio(session, sessionCtx)
}

// streamAudio streams audio data from pipeline to socket connection.
func (m *SessionManager) streamAudio(session *Session, ctx context.Context) {
	defer func() {
		session.SetState(StateStopped)
		m.sendEvent(session.ID, "finished", "")
		fmt.Printf("[Session] Streaming finished for %s, sent %d bytes\n", session.ID[:8], session.BytesSent)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-session.pauseCh:
			// Paused - wait for resume
			session.SetState(StatePaused)
			fmt.Printf("[Session] Paused %s\n", session.ID[:8])
			select {
			case <-ctx.Done():
				return
			case <-session.resumeCh:
				session.SetState(StateStreaming)
				fmt.Printf("[Session] Resumed %s\n", session.ID[:8])
			}
		case chunk, ok := <-session.Pipeline.Output():
			if !ok {
				return // Channel closed
			}

			conn := m.GetConnection()
			if conn == nil {
				continue // No connection, skip chunk
			}

			// Write length header (4 bytes big-endian)
			length := uint32(len(chunk))
			header := []byte{
				byte(length >> 24),
				byte(length >> 16),
				byte(length >> 8),
				byte(length),
			}

			if _, err := conn.Write(header); err != nil {
				fmt.Printf("[Session] Write header error: %v\n", err)
				continue
			}
			if _, err := conn.Write(chunk); err != nil {
				fmt.Printf("[Session] Write chunk error: %v\n", err)
				continue
			}

			session.mu.Lock()
			session.BytesSent += int64(len(chunk))
			session.mu.Unlock()
		}
	}
}

// sendEvent sends a JSON event to the socket connection.
func (m *SessionManager) sendEvent(sessionID string, eventType string, message string) {
	conn := m.GetConnection()
	if conn == nil {
		return
	}

	var event string
	if message != "" {
		event = fmt.Sprintf(`{"type":"%s","session_id":"%s","message":"%s"}`+"\n", eventType, sessionID, message)
	} else {
		event = fmt.Sprintf(`{"type":"%s","session_id":"%s"}`+"\n", eventType, sessionID)
	}

	conn.Write([]byte(event))
}

// Get returns a session by ID.
func (m *SessionManager) Get(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[id]
}

// Stop stops a session by ID.
func (m *SessionManager) Stop(id string) {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()

	if session != nil {
		session.Stop()
	}
}

// Pause pauses a session by ID.
func (m *SessionManager) Pause(id string) error {
	m.mu.RLock()
	session := m.sessions[id]
	m.mu.RUnlock()

	if session == nil {
		return errors.New("session not found")
	}

	session.mu.Lock()
	if session.isPaused {
		session.mu.Unlock()
		return nil // Already paused
	}
	session.isPaused = true
	session.mu.Unlock()

	// Signal pause
	select {
	case session.pauseCh <- struct{}{}:
	default:
	}

	return nil
}

// Resume resumes a paused session by ID.
func (m *SessionManager) Resume(id string) error {
	m.mu.RLock()
	session := m.sessions[id]
	m.mu.RUnlock()

	if session == nil {
		return errors.New("session not found")
	}

	session.mu.Lock()
	if !session.isPaused {
		session.mu.Unlock()
		return nil // Not paused
	}
	session.isPaused = false
	session.mu.Unlock()

	// Signal resume
	select {
	case session.resumeCh <- struct{}{}:
	default:
	}

	return nil
}

// SetState updates the session state.
func (s *Session) SetState(state SessionState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.State = state
}

// GetState returns the current session state.
func (s *Session) GetState() SessionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.State
}

// GetStateString returns the current session state as string.
func (s *Session) GetStateString() string {
	return s.GetState().String()
}

// Stop stops the session and its pipeline.
func (s *Session) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Cancel != nil {
		s.Cancel()
	}
	if s.Pipeline != nil {
		s.Pipeline.Stop()
	}
	s.State = StateStopped
}
