package deps

import (
	"fmt"
	"os/exec"
)

// Checker verifies that required dependencies are available.
// Single Responsibility: Only handles dependency checking.
type Checker struct {
	dependencies []string
}

// NewChecker creates a new dependency checker with the given dependencies.
func NewChecker(deps ...string) *Checker {
	return &Checker{dependencies: deps}
}

// CheckAll verifies all dependencies are available.
// Returns an error listing all missing dependencies.
func (c *Checker) CheckAll() error {
	var missing []string

	for _, dep := range c.dependencies {
		if !c.IsAvailable(dep) {
			missing = append(missing, dep)
		}
	}

	if len(missing) > 0 {
		return &MissingDepsError{Dependencies: missing}
	}

	return nil
}

// IsAvailable checks if a single dependency is available in PATH.
func (c *Checker) IsAvailable(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// CheckAndPrint checks all dependencies and prints status.
// Returns error if any dependency is missing.
func (c *Checker) CheckAndPrint() error {
	var missing []string

	for _, dep := range c.dependencies {
		if c.IsAvailable(dep) {
			fmt.Printf("[OK] %s\n", dep)
		} else {
			fmt.Printf("[ERROR] '%s' not found in PATH\n", dep)
			fmt.Printf("[INFO]  Install '%s' and retry\n\n", dep)
			missing = append(missing, dep)
		}
	}

	if len(missing) > 0 {
		return &MissingDepsError{Dependencies: missing}
	}

	return nil
}

// MissingDepsError is returned when required dependencies are missing.
type MissingDepsError struct {
	Dependencies []string
}

func (e *MissingDepsError) Error() string {
	return fmt.Sprintf("missing dependencies: %v", e.Dependencies)
}
