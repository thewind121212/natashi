package cmd

import (
	"flag"
	"fmt"
	"os"
)

// Config holds the CLI configuration parsed from arguments.
type Config struct {
	Platform string // Platform name (e.g., "youtube")
	URL      string // Media URL
}

// ParseArgs parses command line arguments and returns a Config.
// Single Responsibility: Only handles CLI argument parsing.
func ParseArgs() (*Config, error) {
	config := &Config{}

	flag.StringVar(&config.Platform, "p", "", "Platform name (e.g., youtube)")
	flag.StringVar(&config.Platform, "platform", "", "Platform name (e.g., youtube)")
	flag.StringVar(&config.URL, "url", "", "Media URL to play")

	flag.Usage = printUsage
	flag.Parse()

	// If no flags provided, try positional argument (backward compatibility)
	if config.URL == "" && flag.NArg() > 0 {
		config.URL = flag.Arg(0)
	}

	// Validate required fields
	if config.URL == "" {
		return nil, fmt.Errorf("URL is required")
	}

	return config, nil
}

// printUsage prints the usage information.
func printUsage() {
	fmt.Println("\nUsage:")
	fmt.Println("  music-bot -p <platform> -url <url>")
	fmt.Println("  music-bot <youtube_url>")
	fmt.Println("\nFlags:")
	fmt.Println("  -p, -platform    Platform name (youtube)")
	fmt.Println("  -url             Media URL to play")
	fmt.Println("\nExamples:")
	fmt.Println("  music-bot -p youtube -url https://www.youtube.com/watch?v=dQw4w9WgXcQ")
	fmt.Println("  music-bot https://www.youtube.com/watch?v=dQw4w9WgXcQ")
	fmt.Println()
}

// PrintUsageAndExit prints usage and exits with code 1.
func PrintUsageAndExit() {
	printUsage()
	os.Exit(1)
}
