"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioPlayer = void 0;
const child_process_1 = require("child_process");
const events_1 = require("events");
/**
 * AudioPlayer plays PCM audio to macOS speakers using ffplay.
 * PCM format: s16le, 48000 Hz, 2 channels (stereo)
 */
class AudioPlayer extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.ffplay = null;
        this.isPlaying = false;
        this.bytesWritten = 0;
    }
    /**
     * Start the audio player for PCM input.
     */
    start() {
        if (this.ffplay) {
            this.stop();
        }
        console.log('[AudioPlayer] Starting ffplay for PCM...');
        this.bytesWritten = 0;
        // ffplay reads raw PCM from stdin with low-latency settings
        // Format: s16le (signed 16-bit little-endian), 48kHz, stereo
        this.ffplay = (0, child_process_1.spawn)('ffplay', [
            // Low-latency flags (before input)
            '-fflags', 'nobuffer', // disable buffering
            '-flags', 'low_delay', // low delay mode
            '-probesize', '32', // minimal probe
            '-analyzeduration', '0', // skip analysis
            '-sync', 'ext', // sync to external clock
            // Input format
            '-f', 's16le', // Input format: raw PCM
            '-ar', '48000', // Sample rate: 48kHz
            '-ch_layout', 'stereo', // Channel layout: stereo
            '-i', 'pipe:0', // Read from stdin
            // Output settings
            '-autoexit', // Exit when done
            '-nodisp', // No video display
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
        // Handle stdin errors (EPIPE when ffplay exits)
        this.ffplay.stdin?.on('error', (err) => {
            if (err.code === 'EPIPE') {
                // Expected when ffplay exits - ignore
                return;
            }
            console.error('[AudioPlayer] stdin error:', err.message);
        });
        console.log('[AudioPlayer] Started, PID:', this.ffplay.pid);
    }
    /**
     * Write PCM audio data to the player.
     */
    write(data) {
        if (!this.ffplay || !this.ffplay.stdin || !this.isPlaying) {
            return false;
        }
        // Check if stdin is still writable
        if (this.ffplay.stdin.destroyed || !this.ffplay.stdin.writable) {
            return false;
        }
        try {
            this.bytesWritten += data.length;
            return this.ffplay.stdin.write(data);
        }
        catch {
            // Ignore write errors (EPIPE, etc.) - ffplay might have exited
            return false;
        }
    }
    /**
     * Signal end of audio data.
     */
    end() {
        if (this.ffplay?.stdin) {
            console.log('[AudioPlayer] Ending stream...');
            this.ffplay.stdin.end();
        }
    }
    /**
     * Stop the player immediately.
     */
    stop() {
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
    playing() {
        return this.isPlaying;
    }
}
exports.AudioPlayer = AudioPlayer;
//# sourceMappingURL=audio-player.js.map