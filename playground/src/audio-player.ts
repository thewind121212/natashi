import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * AudioPlayer plays PCM audio to macOS speakers using ffplay.
 * PCM format: s16le, 48000 Hz, 2 channels (stereo)
 */
export class AudioPlayer extends EventEmitter {
  private ffplay: ChildProcess | null = null;
  private isPlaying = false;
  private bytesWritten = 0;

  /**
   * Start the audio player for PCM input.
   */
  start(): void {
    if (this.ffplay) {
      this.stop();
    }

    console.log('[AudioPlayer] Starting ffplay for PCM...');
    this.bytesWritten = 0;

    // ffplay reads raw PCM from stdin with low-latency settings
    // Format: s16le (signed 16-bit little-endian), 48kHz, stereo
    this.ffplay = spawn('ffplay', [
      // Low-latency flags (before input)
      '-fflags', 'nobuffer',     // disable buffering
      '-flags', 'low_delay',     // low delay mode
      '-probesize', '32',        // minimal probe
      '-analyzeduration', '0',   // skip analysis
      '-sync', 'ext',            // sync to external clock
      // Input format
      '-f', 's16le',             // Input format: raw PCM
      '-ar', '48000',            // Sample rate: 48kHz
      '-ch_layout', 'stereo',    // Channel layout: stereo
      '-i', 'pipe:0',            // Read from stdin
      // Output settings
      '-autoexit',               // Exit when done
      '-nodisp',                 // No video display
      '-loglevel', 'warning',
    ]);

    this.isPlaying = true;

    this.ffplay.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('size=')) {
        console.log('[AudioPlayer]', msg);
      }
    });

    this.ffplay.on('close', (code) => {
      console.log('[AudioPlayer] Stopped, played', (this.bytesWritten / 1024).toFixed(0), 'KB');
      this.isPlaying = false;
      this.ffplay = null;
      this.emit('stopped');
    });

    this.ffplay.on('error', (err) => {
      console.error('[AudioPlayer] Error:', err.message);
      this.isPlaying = false;
      this.emit('error', err);
    });

    console.log('[AudioPlayer] Started, PID:', this.ffplay.pid);
  }

  /**
   * Write PCM audio data to the player.
   */
  write(data: Buffer): boolean {
    if (!this.ffplay || !this.ffplay.stdin || !this.isPlaying) {
      return false;
    }

    try {
      this.bytesWritten += data.length;
      return this.ffplay.stdin.write(data);
    } catch (err) {
      console.error('[AudioPlayer] Write error:', err);
      return false;
    }
  }

  /**
   * Signal end of audio data.
   */
  end(): void {
    if (this.ffplay?.stdin) {
      console.log('[AudioPlayer] Ending stream...');
      this.ffplay.stdin.end();
    }
  }

  /**
   * Stop the player immediately.
   */
  stop(): void {
    if (this.ffplay) {
      console.log('[AudioPlayer] Stopping...');
      this.ffplay.kill('SIGTERM');
      this.ffplay = null;
      this.isPlaying = false;
    }
  }

  /**
   * Check if player is currently playing.
   */
  playing(): boolean {
    return this.isPlaying;
  }
}
