package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"music-bot/internal/encoder"
	"music-bot/internal/platform"
	"music-bot/internal/platform/youtube"
)

// Handler processes commands and manages sessions.
type Handler struct {
	sessions *SessionManager
	registry *platform.Registry
}

// NewHandler creates a new command handler.
func NewHandler() *Handler {
	// Setup platform registry
	registry := platform.NewRegistry()
	registry.Register(youtube.New())

	return &Handler{
		sessions: NewSessionManager(),
		registry: registry,
	}
}

// HandleConnection handles a single client connection.
func (h *Handler) HandleConnection(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	var writeMu sync.Mutex // Protect concurrent writes

	decoder := json.NewDecoder(conn)

	writeJSON := func(v interface{}) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return json.NewEncoder(conn).Encode(v)
	}

	writeBinary := func(data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		// Write length header (4 bytes big-endian)
		length := uint32(len(data))
		header := []byte{
			byte(length >> 24),
			byte(length >> 16),
			byte(length >> 8),
			byte(length),
		}
		if _, err := conn.Write(header); err != nil {
			return err
		}
		_, err := conn.Write(data)
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
			var cmd Command
			if err := decoder.Decode(&cmd); err != nil {
				fmt.Printf("[Handler] Decode error: %v\n", err)
				return // Connection closed or error
			}

			fmt.Printf("[Handler] Received command: %s\n", cmd.Type)

			switch cmd.Type {
			case CommandPlay:
				h.handlePlay(ctx, cmd, writeJSON, writeBinary)
			case CommandStop:
				h.sessions.Stop(cmd.SessionID)
				writeJSON(NewFinishedEvent(cmd.SessionID))
			default:
				writeJSON(NewErrorEvent(cmd.SessionID, "unknown command type"))
			}
		}
	}
}

// handlePlay handles the play command.
func (h *Handler) handlePlay(ctx context.Context, cmd Command, writeJSON func(interface{}) error, writeBinary func([]byte) error) {
	startTime := time.Now()
	fmt.Printf("[Handler] Play command: url=%s format=%s\n", cmd.URL, cmd.Format)

	// Determine format
	format := encoder.FormatPCM // Default to PCM for debug
	if cmd.Format == "raw" {
		format = encoder.FormatRaw
	} else if cmd.Format == "webm" {
		format = encoder.FormatWebM
	}

	// Create session
	session := h.sessions.Create(cmd.SessionID, cmd.URL, format)
	session.SetState(StateExtracting)

	// Find extractor for URL
	extractor := h.registry.FindExtractor(cmd.URL)
	if extractor == nil {
		session.SetState(StateError)
		writeJSON(NewErrorEvent(cmd.SessionID, "unsupported URL"))
		return
	}

	extractStart := time.Now()
	fmt.Println("[Handler] Extracting stream URL...")
	// Extract stream URL
	streamURL, err := extractor.ExtractStreamURL(cmd.URL)
	if err != nil {
		session.SetState(StateError)
		writeJSON(NewErrorEvent(cmd.SessionID, fmt.Sprintf("extraction failed: %v", err)))
		return
	}
	fmt.Printf("[Handler] Stream URL extracted in %dms (length: %d)\n", time.Since(extractStart).Milliseconds(), len(streamURL))

	// Create encoding pipeline
	pipeline := encoder.NewDefaultPipeline()
	session.Pipeline = pipeline

	// Create cancellable context for this session
	sessionCtx, cancel := context.WithCancel(ctx)
	session.Cancel = cancel

	// Start pipeline
	fmt.Println("[Handler] Starting encoding pipeline...")
	if err := pipeline.Start(sessionCtx, streamURL, format); err != nil {
		session.SetState(StateError)
		writeJSON(NewErrorEvent(cmd.SessionID, fmt.Sprintf("pipeline failed: %v", err)))
		return
	}

	session.SetState(StateStreaming)

	// Send ready event
	fmt.Printf("[Handler] Sending ready event (total setup: %dms)\n", time.Since(startTime).Milliseconds())
	writeJSON(NewReadyEvent(cmd.SessionID, 0))

	// Stream audio data (blocking - this is intentional for playground)
	// The command loop will continue after streaming is done
	h.streamAudio(session, startTime, writeJSON, writeBinary)
}

// streamAudio streams audio data from pipeline to connection.
func (h *Handler) streamAudio(session *Session, startTime time.Time, writeJSON func(interface{}) error, writeBinary func([]byte) error) {
	defer func() {
		session.SetState(StateStopped)
		fmt.Println("[Handler] Streaming finished, sending finished event")
		writeJSON(NewFinishedEvent(session.ID))
	}()

	chunksSent := 0
	bytesSent := 0
	firstChunk := true
	streamStart := time.Now()

	for chunk := range session.Pipeline.Output() {
		if firstChunk {
			fmt.Printf("[Handler] ⚡ First audio chunk in %dms (from play command)\n", time.Since(startTime).Milliseconds())
			firstChunk = false
		}
		if err := writeBinary(chunk); err != nil {
			fmt.Printf("[Handler] Write error: %v\n", err)
			return
		}
		chunksSent++
		bytesSent += len(chunk)
		if chunksSent%100 == 1 {
			fmt.Printf("[Handler] Sent chunk %d (%d bytes total)\n", chunksSent, bytesSent)
		}
	}
	fmt.Printf("[Handler] Finished sending %d chunks (%d bytes) in %dms\n", chunksSent, bytesSent, time.Since(streamStart).Milliseconds())
}
