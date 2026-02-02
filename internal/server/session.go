package server

import (
	"context"
	"sync"

	"music-bot/internal/encoder"
)

// SessionState represents the current state of a session.
type SessionState int

const (
	StateIdle SessionState = iota
	StateExtracting
	StateStreaming
	StateStopped
	StateError
)

// Session represents an active audio playback session.
type Session struct {
	ID       string
	State    SessionState
	URL      string
	Format   encoder.Format
	Pipeline encoder.Pipeline
	Cancel   context.CancelFunc
	mu       sync.Mutex
}

// SessionManager manages active playback sessions.
// For the playground, we only support a single session at a time.
type SessionManager struct {
	current *Session
	mu      sync.Mutex
}

// NewSessionManager creates a new session manager.
func NewSessionManager() *SessionManager {
	return &SessionManager{}
}

// Create creates a new session, stopping any existing session.
func (m *SessionManager) Create(id string, url string, format encoder.Format) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop existing session if any
	if m.current != nil {
		m.current.Stop()
	}

	m.current = &Session{
		ID:     id,
		State:  StateIdle,
		URL:    url,
		Format: format,
	}
	return m.current
}

// Get returns the current session, or nil if none exists.
func (m *SessionManager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.current != nil && m.current.ID == id {
		return m.current
	}
	return nil
}

// Current returns the current active session.
func (m *SessionManager) Current() *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current
}

// Stop stops the session with the given ID.
func (m *SessionManager) Stop(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.current != nil && m.current.ID == id {
		m.current.Stop()
		m.current = nil
	}
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
