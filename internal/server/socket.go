package server

import (
	"context"
	"fmt"
	"net"
	"os"
	"sync"
)

const DefaultSocketPath = "/tmp/music-playground.sock"

// Server is the Unix socket server for the audio playground.
type Server struct {
	socketPath string
	listener   net.Listener
	handler    *Handler
	wg         sync.WaitGroup
}

// NewServer creates a new Unix socket server.
func NewServer(socketPath string) *Server {
	if socketPath == "" {
		socketPath = DefaultSocketPath
	}
	return &Server{
		socketPath: socketPath,
		handler:    NewHandler(),
	}
}

// Start starts the server and listens for connections.
func (s *Server) Start(ctx context.Context) error {
	// Remove existing socket file if any
	os.Remove(s.socketPath)

	var err error
	s.listener, err = net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", s.socketPath, err)
	}

	fmt.Printf("[INFO] Server listening on %s\n", s.socketPath)

	// Accept connections in background
	go s.acceptLoop(ctx)

	return nil
}

// acceptLoop accepts incoming connections.
func (s *Server) acceptLoop(ctx context.Context) {
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
					fmt.Printf("[ERROR] Accept failed: %v\n", err)
					continue
				}
			}

			fmt.Println("[INFO] Client connected")
			s.wg.Add(1)
			go func() {
				defer s.wg.Done()
				s.handler.HandleConnection(ctx, conn)
				fmt.Println("[INFO] Client disconnected")
			}()
		}
	}
}

// Stop stops the server and waits for all connections to close.
func (s *Server) Stop() {
	if s.listener != nil {
		s.listener.Close()
	}
	s.wg.Wait()
	os.Remove(s.socketPath)
	fmt.Println("[INFO] Server stopped")
}

// SocketPath returns the socket path.
func (s *Server) SocketPath() string {
	return s.socketPath
}
