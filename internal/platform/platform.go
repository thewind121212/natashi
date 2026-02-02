package platform

// StreamExtractor defines the interface for extracting audio streams from various platforms.
// This follows the Interface Segregation Principle (ISP) and Dependency Inversion Principle (DIP).
type StreamExtractor interface {
	// ExtractStreamURL extracts the direct audio stream URL from a given URL
	ExtractStreamURL(url string) (string, error)

	// CanHandle returns true if this extractor can handle the given URL
	CanHandle(url string) bool

	// Name returns the platform name (e.g., "youtube", "soundcloud")
	Name() string
}

// URLValidator defines the interface for validating URLs.
type URLValidator interface {
	// IsValid returns true if the URL is valid for this platform
	IsValid(url string) bool
}

// Registry holds all registered platform extractors.
// This allows for Open/Closed Principle (OCP) - add new platforms without modifying existing code.
type Registry struct {
	extractors []StreamExtractor
}

// NewRegistry creates a new platform registry.
func NewRegistry() *Registry {
	return &Registry{
		extractors: make([]StreamExtractor, 0),
	}
}

// Register adds a new extractor to the registry.
func (r *Registry) Register(extractor StreamExtractor) {
	r.extractors = append(r.extractors, extractor)
}

// FindExtractor finds an extractor that can handle the given URL.
func (r *Registry) FindExtractor(url string) StreamExtractor {
	for _, ext := range r.extractors {
		if ext.CanHandle(url) {
			return ext
		}
	}
	return nil
}

// GetExtractorByName finds an extractor by platform name.
func (r *Registry) GetExtractorByName(name string) StreamExtractor {
	for _, ext := range r.extractors {
		if ext.Name() == name {
			return ext
		}
	}
	return nil
}

// ListPlatforms returns all registered platform names.
func (r *Registry) ListPlatforms() []string {
	names := make([]string, len(r.extractors))
	for i, ext := range r.extractors {
		names[i] = ext.Name()
	}
	return names
}
