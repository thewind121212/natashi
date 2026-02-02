import { EventEmitter } from 'events';
/**
 * AudioPlayer plays PCM audio to macOS speakers using ffplay.
 * PCM format: s16le, 48000 Hz, 2 channels (stereo)
 */
export declare class AudioPlayer extends EventEmitter {
    private ffplay;
    private isPlaying;
    private bytesWritten;
    /**
     * Start the audio player for PCM input.
     */
    start(): void;
    /**
     * Write PCM audio data to the player.
     */
    write(data: Buffer): boolean;
    /**
     * Signal end of audio data.
     */
    end(): void;
    /**
     * Stop the player immediately.
     */
    stop(): void;
    /**
     * Check if player is currently playing.
     */
    playing(): boolean;
}
//# sourceMappingURL=audio-player.d.ts.map