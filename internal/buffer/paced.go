package buffer

import (
	"context"
	"time"
)

type Config struct {
	Bitrate     int
	Prebuffer   time.Duration
	MinDelay    time.Duration
	MaxDelay    time.Duration
	MaxBuffer   time.Duration
	Interval    time.Duration
	Passthrough bool
}

type PacedBuffer struct {
	cfg Config
}

func NewPacedBuffer(cfg Config) *PacedBuffer {
	return &PacedBuffer{cfg: cfg}
}

func (p *PacedBuffer) Start(ctx context.Context, input <-chan []byte) <-chan []byte {
	output := make(chan []byte)

	go func() {
		defer close(output)

		var queue [][]byte
		var buffered time.Duration
		var timer *time.Timer
		inputOpen := true
		ready := false
		started := false

		for {
			if !ready {
				if !inputOpen && len(queue) == 0 {
					return
				}

				select {
				case <-ctx.Done():
					return
				case chunk, ok := <-input:
					if !ok {
						inputOpen = false
						if len(queue) > 0 {
							ready = true
						}
						continue
					}
					queue = append(queue, chunk)
					buffered += p.durationFor(chunk)
					p.trimQueue(&queue, &buffered)
					if buffered >= p.cfg.Prebuffer {
						ready = true
					}
				}
				continue
			}

			if len(queue) == 0 {
				if !inputOpen {
					return
				}
				select {
				case <-ctx.Done():
					return
				case chunk, ok := <-input:
					if !ok {
						inputOpen = false
						continue
					}
					queue = append(queue, chunk)
					buffered += p.durationFor(chunk)
				}
				continue
			}

			if p.cfg.Passthrough {
				chunk := queue[0]
				queue = queue[1:]
				buffered -= p.durationFor(chunk)
				if buffered < 0 {
					buffered = 0
				}
				select {
				case <-ctx.Done():
					return
				case output <- chunk:
				}
				continue
			}

			if timer == nil {
				delay := time.Duration(0)
				if started {
					delay = p.durationFor(queue[0])
					if delay < time.Millisecond {
						delay = time.Millisecond
					}
				}
				timer = time.NewTimer(delay)
			}

			select {
			case <-ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case chunk, ok := <-input:
				if !ok {
					inputOpen = false
					continue
				}
				queue = append(queue, chunk)
				buffered += p.durationFor(chunk)
				p.trimQueue(&queue, &buffered)
			case <-timer.C:
				timer = nil
				chunk := queue[0]
				queue = queue[1:]
				buffered -= p.durationFor(chunk)
				if buffered < 0 {
					buffered = 0
				}
				started = true
				select {
				case <-ctx.Done():
					return
				case output <- chunk:
				}
			}
		}
	}()

	return output
}

func (p *PacedBuffer) trimQueue(queue *[][]byte, buffered *time.Duration) {
	if p.cfg.MaxBuffer <= 0 {
		return
	}

	for *buffered > p.cfg.MaxBuffer && len(*queue) > 0 {
		dropped := (*queue)[0]
		*queue = (*queue)[1:]
		*buffered -= p.durationFor(dropped)
		if *buffered < 0 {
			*buffered = 0
			break
		}
	}
}

func (p *PacedBuffer) durationFor(chunk []byte) time.Duration {
	if p.cfg.Interval > 0 {
		return p.cfg.Interval
	}
	if p.cfg.Bitrate <= 0 {
		return 20 * time.Millisecond
	}
	bytesPerSecond := float64(p.cfg.Bitrate) / 8.0
	seconds := float64(len(chunk)) / bytesPerSecond
	duration := time.Duration(seconds * float64(time.Second))
	if p.cfg.MinDelay > 0 && duration < p.cfg.MinDelay {
		return p.cfg.MinDelay
	}
	if p.cfg.MaxDelay > 0 && duration > p.cfg.MaxDelay {
		return p.cfg.MaxDelay
	}
	return duration
}
