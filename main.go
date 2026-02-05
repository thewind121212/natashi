package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"music-bot/cmd"
	"music-bot/internal/platform"
	"music-bot/internal/platform/youtube"
	"music-bot/internal/player/ffmpeg"
	"music-bot/pkg/deps"
)

func main() {
	// ─── Step 1: Parse CLI arguments ───
	config, err := cmd.ParseArgs()
	if err != nil {
		fmt.Println("[ERROR]", err)
		cmd.PrintUsageAndExit()
	}

	// ─── Step 2: Check dependencies ───
	checker := deps.NewChecker("yt-dlp", "ffmpeg")
	if err := checker.CheckAndPrint(); err != nil {
		os.Exit(1)
	}

	// Load YouTube config from environment
	youtube.LoadConfigFromEnv()

	// ─── Step 3: Setup platform registry (Open/Closed Principle) ───
	registry := platform.NewRegistry()
	registry.Register(youtube.New())
	// Easy to add new platforms:
	// registry.Register(soundcloud.New())
	// registry.Register(spotify.New())

	// ─── Step 4: Find appropriate extractor ───
	var extractor platform.StreamExtractor

	if config.Platform != "" {
		// User specified a platform
		extractor = registry.GetExtractorByName(config.Platform)
		if extractor == nil {
			fmt.Printf("[ERROR] Unknown platform: %s\n", config.Platform)
			fmt.Printf("[INFO] Available platforms: %v\n", registry.ListPlatforms())
			os.Exit(1)
		}
	} else {
		// Auto-detect platform from URL
		extractor = registry.FindExtractor(config.URL)
		if extractor == nil {
			fmt.Println("[ERROR] Could not detect platform from URL")
			fmt.Printf("[INFO] Please specify platform with -p flag\n")
			fmt.Printf("[INFO] Available platforms: %v\n", registry.ListPlatforms())
			os.Exit(1)
		}
	}

	fmt.Printf("[INFO] Using platform: %s\n", extractor.Name())
	fmt.Println("[INFO] URL:", config.URL)

	// ─── Step 5: Extract stream URL ───
	fmt.Println("[INFO] Fetching audio stream...")
	streamURL, err := extractor.ExtractStreamURL(config.URL)
	if err != nil {
		fmt.Println("[ERROR]", err)
		os.Exit(1)
	}
	fmt.Println("[INFO] Stream extracted")

	// ─── Step 6: Setup context with signal handling ───
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sig
		cancel()
	}()

	// ─── Step 7: Play audio (Dependency Inversion - uses interface) ───
	fmt.Println("[INFO] Playing audio...")
	fmt.Println("[INFO] Press Ctrl+C to stop\n")

	audioPlayer := ffmpeg.NewDefault()
	if err := audioPlayer.Play(ctx, streamURL); err != nil {
		if err != context.Canceled {
			fmt.Println("[ERROR]", err)
			os.Exit(1)
		}
	}
}
