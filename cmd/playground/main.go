// Package main provides the entry point for the audio playground server.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"music-bot/internal/server"
	"music-bot/pkg/deps"
)

func main() {
	fmt.Println("=== Audio Playground Server ===")

	// Check dependencies
	checker := deps.NewChecker("yt-dlp", "ffmpeg")
	if err := checker.CheckAndPrint(); err != nil {
		os.Exit(1)
	}

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

	// Start server
	srv := server.NewServer("")
	if err := srv.Start(ctx); err != nil {
		fmt.Printf("[ERROR] %v\n", err)
		os.Exit(1)
	}

	fmt.Println("[INFO] Press Ctrl+C to stop")

	// Wait for shutdown
	<-ctx.Done()
	srv.Stop()
}
