package server

import (
	"fmt"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
)

var serverStartTime = time.Now()

// SetupRouter creates and configures the Gin router.
func SetupRouter(api *API) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	// Session control endpoints
	session := r.Group("/session/:id")
	{
		session.POST("/play", api.Play)
		session.POST("/stop", api.Stop)
		session.POST("/pause", api.Pause)
		session.POST("/resume", api.Resume)
		session.GET("/status", api.Status)
	}

	// Metadata endpoint (for queue)
	r.GET("/metadata", api.Metadata)

	// Playlist endpoint (extract all videos from playlist)
	r.GET("/playlist", api.Playlist)

	// Search endpoint (YouTube search)
	r.GET("/search", api.Search)

	// Health check with system stats
	r.GET("/health", func(c *gin.Context) {
		var memStats runtime.MemStats
		runtime.ReadMemStats(&memStats)

		uptimeSeconds := int64(time.Since(serverStartTime).Seconds())
		ramMB := float64(memStats.Alloc) / 1024 / 1024

		c.JSON(200, gin.H{
			"status":             "ok",
			"uptime_seconds":     uptimeSeconds,
			"ram_mb":             fmt.Sprintf("%.2f", ramMB),
			"goroutines":        runtime.NumGoroutine(),
			"sessions_active":   api.sessions.ActiveSessionCount(),
			"sessions_playing":  api.sessions.StreamingSessionCount(),
			"go_version":        runtime.Version(),
			"os":                runtime.GOOS,
			"arch":              runtime.GOARCH,
		})
	})

	return r
}

// corsMiddleware handles CORS for browser requests.
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
