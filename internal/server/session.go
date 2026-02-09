package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"music-bot/internal/buffer"
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

// Retry configuration
const (
	maxRetries          = 3               // Maximum retry attempts for premature stream endings
	minPlayedForRetry   = 5 * time.Second // Minimum played time before considering retry
	prematureEndingGap  = 10.0            // Seconds before expected end to consider premature
)

// Session represents an active audio playback session.
type Session struct {
	ID               string
	State            SessionState
	URL              string
	Format           encoder.Format
	StartAt          float64
	Pipeline         encoder.Pipeline
	Cancel           context.CancelFunc
	BytesSent        int64
	isPaused         bool
	resumeCh         chan struct{} // Signal to resume from pause
	mu               sync.Mutex

	// Auto-retry fields
	expectedDuration float64   // Expected duration in seconds (from metadata)
	streamStartTime  time.Time // When streaming started (for calculating played time)
	retryCount       int       // Current retry attempt
	isStopped        bool      // Explicitly stopped by user (don't retry)
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

func shortSessionID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

// StartPlayback starts a new playback session (non-blocking).
// duration is optional (0 = unknown) - if provided, skips slow metadata extraction.
func (m *SessionManager) StartPlayback(id string, url string, formatStr string, startAtSec float64, duration float64) error {
	m.mu.Lock()

	// Stop only the session with the same ID (if exists)
	// This allows concurrent sessions for different guilds/users
	if existing, ok := m.sessions[id]; ok {
		fmt.Printf("[Session] Stopping existing session %s for new playback\n", shortSessionID(id))
		existing.Stop()
		delete(m.sessions, id)
	}

	// Determine format
	format := encoder.FormatPCM
	switch formatStr {
	case "opus":
		format = encoder.FormatOpus
	case "web":
		format = encoder.FormatWeb
	}

	session := &Session{
		ID:               id,
		State:            StateIdle,
		URL:              url,
		Format:           format,
		StartAt:          startAtSec,
		expectedDuration: duration, // Use duration from Node.js (skips yt-dlp metadata call if > 0)
		resumeCh:         make(chan struct{}, 1),
	}
	m.sessions[id] = session
	m.mu.Unlock()

	// Start playback in goroutine (non-blocking)
	go m.runPlayback(session)

	return nil
}

// runPlayback runs the playback pipeline for a session.
func (m *SessionManager) runPlayback(session *Session) {
	m.runPlaybackWithRetry(session, session.StartAt)
}

// runPlaybackWithRetry runs playback with retry support for premature endings.
func (m *SessionManager) runPlaybackWithRetry(session *Session, seekPosition float64) {
	// Create cancellable context FIRST - allows Stop() to cancel during extraction
	sessionCtx, cancel := context.WithCancel(m.ctx)
	session.mu.Lock()
	session.Cancel = cancel
	session.isStopped = false
	session.mu.Unlock()

	session.SetState(StateExtracting)
	isRetry := session.retryCount > 0
	if isRetry {
		fmt.Printf("[Session] Retry #%d for %s (seeking to %.1fs)\n", session.retryCount, shortSessionID(session.ID), seekPosition)
	} else {
		fmt.Printf("[Session] Starting playback for %s\n", shortSessionID(session.ID))
	}

	// Find extractor for URL
	extractor := m.registry.FindExtractor(session.URL)
	if extractor == nil {
		session.SetState(StateError)
		m.sendEvent(session.ID, "error", "unsupported URL")
		return
	}

	// Check if cancelled before extraction
	select {
	case <-sessionCtx.Done():
		fmt.Printf("[Session] Cancelled before extraction %s\n", shortSessionID(session.ID))
		return
	default:
	}

	// Get metadata for duration (only if not provided by Node.js and not a retry)
	// If duration was passed from Node.js, skip this slow yt-dlp call
	if !isRetry && session.expectedDuration == 0 {
		if ytExtractor, ok := extractor.(*youtube.Extractor); ok {
			if meta, err := ytExtractor.ExtractMetadata(session.URL); err == nil && meta.Duration > 0 {
				session.mu.Lock()
				session.expectedDuration = float64(meta.Duration)
				session.mu.Unlock()
				fmt.Printf("[Session] Track duration: %.0fs (from yt-dlp)\n", session.expectedDuration)
			}
		}
	} else if session.expectedDuration > 0 {
		fmt.Printf("[Session] Track duration: %.0fs (from Node.js, skipped yt-dlp)\n", session.expectedDuration)
	}

	// Extract stream URL (fresh URL for each attempt - important for retries)
	fmt.Println("[Session] Extracting stream URL...")
	streamURL, err := extractor.ExtractStreamURL(session.URL)
	if err != nil {
		session.SetState(StateError)
		m.sendEvent(session.ID, "error", fmt.Sprintf("extraction failed: %v", err))
		return
	}

	// Check if cancelled after extraction (user clicked play again during yt-dlp)
	select {
	case <-sessionCtx.Done():
		fmt.Printf("[Session] Cancelled after extraction %s\n", shortSessionID(session.ID))
		return
	default:
	}

	fmt.Printf("[Session] Stream URL extracted (length: %d)\n", len(streamURL))

	// Create encoding pipeline
	pipeline := encoder.NewDefaultPipeline()
	pipeline.SetSessionID(session.ID)
	session.mu.Lock()
	session.Pipeline = pipeline
	session.BytesSent = 0 // Reset bytes for this attempt
	session.streamStartTime = time.Now()
	session.mu.Unlock()

	// Start pipeline with seek position
	fmt.Printf("[Session] Starting encoding pipeline (seek: %.1fs)...\n", seekPosition)
	if err := pipeline.Start(sessionCtx, streamURL, session.Format, seekPosition); err != nil {
		session.SetState(StateError)
		m.sendEvent(session.ID, "error", fmt.Sprintf("pipeline failed: %v", err))
		return
	}

	session.SetState(StateStreaming)

	// Only send ready event on first attempt (not on retry)
	if !isRetry {
		m.sendEvent(session.ID, "ready", "")
	}

	// Stream audio data
	prematureEnd := m.streamAudio(session, sessionCtx)

	// Check if we should retry
	session.mu.Lock()
	stopped := session.isStopped
	retries := session.retryCount
	expectedDur := session.expectedDuration
	session.mu.Unlock()

	if prematureEnd && !stopped && retries < maxRetries {
		// Calculate where we stopped
		playedTime := time.Since(session.streamStartTime).Seconds()
		newSeekPosition := seekPosition + playedTime

		// Only retry if we played some content and haven't reached near the end
		if playedTime >= minPlayedForRetry.Seconds() &&
		   (expectedDur == 0 || newSeekPosition < expectedDur-prematureEndingGap) {
			session.mu.Lock()
			session.retryCount++
			session.mu.Unlock()

			fmt.Printf("[Session] Premature end detected for %s (played %.1fs), retrying from %.1fs...\n",
				shortSessionID(session.ID), playedTime, newSeekPosition)

			// Small delay before retry to avoid hammering YouTube
			time.Sleep(1 * time.Second)

			// Retry with new seek position
			m.runPlaybackWithRetry(session, newSeekPosition)
			return
		}
	}

	// Normal end or no retry needed
	session.SetState(StateStopped)
	m.sendEvent(session.ID, "finished", "")
	fmt.Printf("[Session] Streaming finished for %s, sent %d bytes\n", shortSessionID(session.ID), session.BytesSent)
}

// streamAudio streams audio data from pipeline to socket connection.
// Returns true if the stream ended prematurely (potential retry candidate).
func (m *SessionManager) streamAudio(session *Session, ctx context.Context) (prematureEnd bool) {
	output := session.Pipeline.Output()
	if session.Format == encoder.FormatWeb {
		paced := buffer.NewPacedBuffer(buffer.Config{
			Bitrate:     256000,
			Prebuffer:   500 * time.Millisecond,
			MaxBuffer:   2 * time.Second,
			Passthrough: true,
		})
		output = paced.Start(ctx, output)
	}

	for {
		select {
		case <-ctx.Done():
			// Context cancelled (user stopped) - not a premature end
			return false
		case chunk, ok := <-output:
			if !ok {
				// Channel closed - check if premature
				session.mu.Lock()
				playedTime := time.Since(session.streamStartTime).Seconds()
				expectedDur := session.expectedDuration
				stopped := session.isStopped
				bytesSent := session.BytesSent
				session.mu.Unlock()

				// Consider premature if:
				// 1. Not explicitly stopped by user
				// 2. Expected duration is known and we're well short of it
				// 3. OR expected duration unknown but we played very little
				// 4. OR bytes sent are much less than expected for the duration
				if !stopped {
					if expectedDur > 0 && playedTime < expectedDur-prematureEndingGap {
						fmt.Printf("[Session] Stream ended early for %s: played %.1fs of expected %.1fs\n",
							shortSessionID(session.ID), playedTime, expectedDur)
						return true
					} else if expectedDur == 0 && playedTime < 30 {
						// Unknown duration but very short playback - likely an error
						fmt.Printf("[Session] Stream ended suspiciously early for %s: only %.1fs played\n",
							shortSessionID(session.ID), playedTime)
						return true
					}
					// Byte-based check: if expected duration is known, verify we sent
					// enough bytes. At 128kbps Opus, expect ~16KB/s. If we got less
					// than 60% of expected bytes, stream was likely truncated by TLS errors.
					if expectedDur > 0 {
						expectedBytes := int64(expectedDur * 16000) // ~128kbps = 16KB/s
						if bytesSent < expectedBytes*60/100 {
							fmt.Printf("[Session] Stream data too short for %s: sent %d bytes, expected ~%d bytes (%.0f%%)\n",
								shortSessionID(session.ID), bytesSent, expectedBytes, float64(bytesSent)*100/float64(expectedBytes))
							return true
						}
					}
				}
				return false
			}

			// Check if paused BEFORE writing (immediate response)
			session.mu.Lock()
			paused := session.isPaused
			session.mu.Unlock()

			if paused {
				session.SetState(StatePaused)
				fmt.Printf("[Session] Paused %s (dropping chunk)\n", shortSessionID(session.ID))

				// Drain any stale resume signals before waiting
				select {
				case <-session.resumeCh:
				default:
				}

				// Wait for resume signal
			waitLoop:
				for {
					select {
					case <-ctx.Done():
						return false // Context cancelled - not premature
					case <-session.resumeCh:
						// Check if actually resumed (not a stale signal)
						session.mu.Lock()
						stillPaused := session.isPaused
						session.mu.Unlock()
						if !stillPaused {
							session.SetState(StateStreaming)
							fmt.Printf("[Session] Resumed %s\n", shortSessionID(session.ID))
							break waitLoop
						}
						// Still paused, keep waiting
					}
				}
				continue // Get next chunk after resume
			}

			conn := m.GetConnection()
			if conn == nil {
				continue // No connection, skip chunk (will retry on next chunk)
			}

			// Coalesce header + session ID + chunk into single write to avoid TCP Nagle delays
			// Header: 4 bytes big-endian length (includes session ID + audio data)
			// Session ID: 24 bytes, right-padded with spaces (truncated if longer)
			const sessionIDLen = 24
			sessionID := session.ID
			if len(sessionID) > sessionIDLen {
				sessionID = sessionID[:sessionIDLen]
			}
			paddedID := fmt.Sprintf("%-24s", sessionID)

			length := uint32(sessionIDLen + len(chunk))
			packet := make([]byte, 4+sessionIDLen+len(chunk))
			packet[0] = byte(length >> 24)
			packet[1] = byte(length >> 16)
			packet[2] = byte(length >> 8)
			packet[3] = byte(length)
			copy(packet[4:4+sessionIDLen], paddedID)
			copy(packet[4+sessionIDLen:], chunk)

			if _, err := conn.Write(packet); err != nil {
				// Connection broken - clear it and wait for reconnect
				fmt.Printf("[Session] Write error (connection lost): %v\n", err)
				m.SetConnection(nil)
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

// ActiveSessionCount returns the number of active sessions.
func (m *SessionManager) ActiveSessionCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}

// StreamingSessionCount returns the number of sessions currently streaming.
func (m *SessionManager) StreamingSessionCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, s := range m.sessions {
		if s.GetState() == StateStreaming {
			count++
		}
	}
	return count
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

	// Pause the pipeline (SIGSTOP to FFmpeg + drain buffer)
	if session.Pipeline != nil {
		session.Pipeline.Pause()
	}
	session.mu.Unlock()

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

	// Resume the pipeline (SIGCONT to FFmpeg)
	if session.Pipeline != nil {
		session.Pipeline.Resume()
	}

	session.isPaused = false
	session.mu.Unlock()

	// Signal resume to streamAudio goroutine
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

	s.isStopped = true // Mark as explicitly stopped (prevents auto-retry)
	if s.Cancel != nil {
		s.Cancel()
	}
	if s.Pipeline != nil {
		s.Pipeline.Stop()
	}
	s.State = StateStopped
}
