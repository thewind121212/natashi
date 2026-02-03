package server

import (
	"context"
	"fmt"
	"net"
	"os"
	"sync"
)

const DefaultSocketPath = "/tmp/music-playground.sock"

// SocketServer is the Unix socket server for audio streaming.
// It only handles audio output - control is done via HTTP API.
type SocketServer struct {
	socketPath string
	listener   net.Listener
	sessions   *SessionManager
	wg         sync.WaitGroup
}

// NewSocketServer creates a new Unix socket server.
func NewSocketServer(socketPath string, sessions *SessionManager) *SocketServer {
	if socketPath == "" {
		socketPath = DefaultSocketPath
	}
	return &SocketServer{
		socketPath: socketPath,
		sessions:   sessions,
	}
}

// Start starts the server and listens for connections.
func (s *SocketServer) Start(ctx context.Context) error {
	// Remove existing socket file if any
	os.Remove(s.socketPath)

	var err error
	s.listener, err = net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", s.socketPath, err)
	}

	fmt.Printf("[Socket] Listening on %s\n", s.socketPath)

	// Accept connections in background
	go s.acceptLoop(ctx)

	return nil
}

// acceptLoop accepts incoming connections.
func (s *SocketServer) acceptLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			conn, err := s.listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					fmt.Printf("[Socket] Accept failed: %v\n", err)
					continue
				}
			}

			fmt.Println("[Socket] Client connected")
			s.wg.Add(1)
			go func() {
				defer s.wg.Done()
				s.handleConnection(ctx, conn)
				fmt.Println("[Socket] Client disconnected")
			}()
		}
	}
}

// handleConnection handles a single client connection.
// The connection is used for receiving audio data from sessions.
func (s *SocketServer) handleConnection(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	// Register this connection with session manager
	s.sessions.SetConnection(conn)
	defer s.sessions.SetConnection(nil)

	// Keep connection alive until context is cancelled or connection closes
	<-ctx.Done()
}

// Stop stops the server and waits for all connections to close.
func (s *SocketServer) Stop() {
	if s.listener != nil {
		s.listener.Close()
	}
	s.wg.Wait()
	os.Remove(s.socketPath)
	fmt.Println("[Socket] Server stopped")
}

// SocketPath returns the socket path.
func (s *SocketServer) SocketPath() string {
	return s.socketPath
}
