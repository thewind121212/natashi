package server

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSocketServer_NewWithDefaultPath(t *testing.T) {
	ctx := context.Background()
	sessions := NewSessionManager(ctx)
	server := NewSocketServer("", sessions)

	if server.SocketPath() != DefaultSocketPath {
		t.Errorf("expected default path %s, got %s", DefaultSocketPath, server.SocketPath())
	}
}

func TestSocketServer_NewWithCustomPath(t *testing.T) {
	ctx := context.Background()
	sessions := NewSessionManager(ctx)
	customPath := "/tmp/test-custom.sock"
	server := NewSocketServer(customPath, sessions)

	if server.SocketPath() != customPath {
		t.Errorf("expected custom path %s, got %s", customPath, server.SocketPath())
	}
}

func TestSocketServer_StartAndStop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sessions := NewSessionManager(ctx)

	// Use temp file path for test socket
	tmpDir := os.TempDir()
	socketPath := filepath.Join(tmpDir, "test-music-bot.sock")
	defer os.Remove(socketPath)

	server := NewSocketServer(socketPath, sessions)

	// Start server
	err := server.Start(ctx)
	if err != nil {
		t.Fatalf("failed to start server: %v", err)
	}

	// Verify socket file exists
	if _, err := os.Stat(socketPath); os.IsNotExist(err) {
		t.Error("socket file was not created")
	}

	// Stop server
	cancel()
	server.Stop()

	// Give it a moment to clean up
	time.Sleep(50 * time.Millisecond)
}

func TestSocketServer_AcceptConnection(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sessions := NewSessionManager(ctx)

	tmpDir := os.TempDir()
	socketPath := filepath.Join(tmpDir, "test-music-bot-accept.sock")
	defer os.Remove(socketPath)

	server := NewSocketServer(socketPath, sessions)

	err := server.Start(ctx)
	if err != nil {
		t.Fatalf("failed to start server: %v", err)
	}

	// Connect as client
	conn, err := net.DialTimeout("unix", socketPath, time.Second)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer conn.Close()

	// Give server time to accept
	time.Sleep(50 * time.Millisecond)

	// Verify connection was registered
	if sessions.GetConnection() == nil {
		t.Error("expected connection to be registered with session manager")
	}

	// Cleanup
	cancel()
	server.Stop()
}

// TestAudioProtocol tests the binary protocol format:
// 4-byte big-endian length header + audio data
func TestAudioProtocol_HeaderFormat(t *testing.T) {
	// Test encoding a 1000 byte chunk
	chunkSize := uint32(1000)

	// Build header like session.go does
	header := make([]byte, 4)
	header[0] = byte(chunkSize >> 24)
	header[1] = byte(chunkSize >> 16)
	header[2] = byte(chunkSize >> 8)
	header[3] = byte(chunkSize)

	// Verify header bytes
	expected := []byte{0x00, 0x00, 0x03, 0xE8} // 1000 in big-endian
	for i, b := range expected {
		if header[i] != b {
			t.Errorf("header[%d] = %02x, expected %02x", i, header[i], b)
		}
	}

	// Decode header
	decoded := (uint32(header[0]) << 24) | (uint32(header[1]) << 16) |
		(uint32(header[2]) << 8) | uint32(header[3])

	if decoded != chunkSize {
		t.Errorf("decoded size = %d, expected %d", decoded, chunkSize)
	}
}

func TestAudioProtocol_LargeChunk(t *testing.T) {
	// Test with larger chunk (64KB)
	chunkSize := uint32(65536)

	header := make([]byte, 4)
	header[0] = byte(chunkSize >> 24)
	header[1] = byte(chunkSize >> 16)
	header[2] = byte(chunkSize >> 8)
	header[3] = byte(chunkSize)

	// Verify: 0x00010000 = 65536
	expected := []byte{0x00, 0x01, 0x00, 0x00}
	for i, b := range expected {
		if header[i] != b {
			t.Errorf("header[%d] = %02x, expected %02x", i, header[i], b)
		}
	}
}
