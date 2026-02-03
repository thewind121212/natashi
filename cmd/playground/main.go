// Package main provides the entry point for the audio playground server.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"music-bot/internal/platform/youtube"
	"music-bot/internal/server"
	"music-bot/pkg/deps"
)

func main() {
	// Get port from environment or default
	httpPort := os.Getenv("GO_API_PORT")
	if httpPort == "" {
		httpPort = "8180"
	}
	httpPort = ":" + httpPort
	fmt.Println("=== Audio Playground Server ===")

	// Check dependencies
	checker := deps.NewChecker("yt-dlp", "ffmpeg")
	if err := checker.CheckAndPrint(); err != nil {
		os.Exit(1)
	}

	// Load YouTube config from environment
	youtube.LoadConfigFromEnv()

	// Setup context with signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sig
		fmt.Println("\n[INFO] Shutting down...")
		cancel()
	}()

	// Create shared session manager
	sessions := server.NewSessionManager(ctx)

	// Start HTTP API server (Gin)
	api := server.NewAPI(sessions)
	router := server.SetupRouter(api)

	go func() {
		fmt.Printf("[HTTP] API server listening on http://localhost%s\n", httpPort)
		if err := router.Run(httpPort); err != nil {
			fmt.Printf("[HTTP] Server error: %v\n", err)
		}
	}()

	// Start Unix socket server (audio streaming)
	socketSrv := server.NewSocketServer("", sessions)
	if err := socketSrv.Start(ctx); err != nil {
		fmt.Printf("[ERROR] %v\n", err)
		os.Exit(1)
	}

	fmt.Println("[INFO] Ready!")
	fmt.Println("[INFO] - HTTP API: http://localhost" + httpPort)
	fmt.Println("[INFO] - Socket: /tmp/music-playground.sock")
	fmt.Println("[INFO] Press Ctrl+C to stop")

	// Wait for shutdown
	<-ctx.Done()
	socketSrv.Stop()
}
