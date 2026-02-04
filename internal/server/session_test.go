package server

import (
	"context"
	"testing"
)

func TestSessionManager_GetNonexistent(t *testing.T) {
	ctx := context.Background()
	sm := NewSessionManager(ctx)

	session := sm.Get("nonexistent")
	if session != nil {
		t.Error("expected nil for nonexistent session")
	}
}

func TestSessionManager_StopNonexistent(t *testing.T) {
	ctx := context.Background()
	sm := NewSessionManager(ctx)

	// Should not panic
	sm.Stop("nonexistent")
}

func TestSessionManager_PauseNonexistent(t *testing.T) {
	ctx := context.Background()
	sm := NewSessionManager(ctx)

	err := sm.Pause("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
	if err.Error() != "session not found" {
		t.Errorf("expected 'session not found', got %s", err.Error())
	}
}

func TestSessionManager_ResumeNonexistent(t *testing.T) {
	ctx := context.Background()
	sm := NewSessionManager(ctx)

	err := sm.Resume("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
	if err.Error() != "session not found" {
		t.Errorf("expected 'session not found', got %s", err.Error())
	}
}

func TestSessionManager_SetConnection(t *testing.T) {
	ctx := context.Background()
	sm := NewSessionManager(ctx)

	// Initial connection should be nil
	if conn := sm.GetConnection(); conn != nil {
		t.Error("expected nil initial connection")
	}

	// SetConnection(nil) should work
	sm.SetConnection(nil)
	if conn := sm.GetConnection(); conn != nil {
		t.Error("expected nil connection after SetConnection(nil)")
	}
}

func TestSession_StateTransitions(t *testing.T) {
	session := &Session{
		ID:       "test",
		State:    StateIdle,
		resumeCh: make(chan struct{}, 1),
	}

	// Test state transitions
	session.SetState(StateExtracting)
	if session.GetState() != StateExtracting {
		t.Errorf("expected StateExtracting, got %v", session.GetState())
	}

	session.SetState(StateStreaming)
	if session.GetState() != StateStreaming {
		t.Errorf("expected StateStreaming, got %v", session.GetState())
	}

	session.SetState(StatePaused)
	if session.GetStateString() != "paused" {
		t.Errorf("expected 'paused', got %s", session.GetStateString())
	}

	session.SetState(StateStopped)
	if session.GetState() != StateStopped {
		t.Errorf("expected StateStopped, got %v", session.GetState())
	}
}

func TestSession_Stop(t *testing.T) {
	cancelCalled := false
	session := &Session{
		ID:       "test",
		State:    StateStreaming,
		resumeCh: make(chan struct{}, 1),
		Cancel: func() {
			cancelCalled = true
		},
	}

	session.Stop()

	if !cancelCalled {
		t.Error("expected Cancel to be called")
	}
	if session.GetState() != StateStopped {
		t.Errorf("expected StateStopped, got %v", session.GetState())
	}
}
