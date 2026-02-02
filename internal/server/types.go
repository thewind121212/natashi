// Package server provides the Unix socket server for the audio playground.
package server

// CommandType identifies the type of command from Node.js.
type CommandType string

const (
	CommandPlay CommandType = "play"
	CommandStop CommandType = "stop"
)

// Command represents a command received from Node.js.
type Command struct {
	Type      CommandType `json:"type"`
	SessionID string      `json:"session_id"`
	URL       string      `json:"url,omitempty"`
	Format    string      `json:"format,omitempty"` // "webm" or "raw"
}

// EventType identifies the type of event sent to Node.js.
type EventType string

const (
	EventReady    EventType = "ready"
	EventError    EventType = "error"
	EventFinished EventType = "finished"
)

// Event represents an event sent to Node.js.
type Event struct {
	Type      EventType `json:"type"`
	SessionID string    `json:"session_id"`
	Duration  int       `json:"duration,omitempty"` // seconds, 0 if unknown
	Message   string    `json:"message,omitempty"`  // error message
}

// NewReadyEvent creates a ready event.
func NewReadyEvent(sessionID string, duration int) Event {
	return Event{
		Type:      EventReady,
		SessionID: sessionID,
		Duration:  duration,
	}
}

// NewErrorEvent creates an error event.
func NewErrorEvent(sessionID string, message string) Event {
	return Event{
		Type:      EventError,
		SessionID: sessionID,
		Message:   message,
	}
}

// NewFinishedEvent creates a finished event.
func NewFinishedEvent(sessionID string) Event {
	return Event{
		Type:      EventFinished,
		SessionID: sessionID,
	}
}
