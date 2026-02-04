import { useRef, useCallback } from 'react';
import { OggOpusDecoder } from 'ogg-opus-decoder';

interface UseAudioPlayerOptions {
  onProgress?: (seconds: number) => void;
}

interface UseAudioPlayerReturn {
  init: () => Promise<void>;
  playChunk: (opusData: Uint8Array) => Promise<void>;
  reset: () => void;
  stop: () => void;
  isInitialized: () => boolean;
}

/**
 * Audio Buffer Configuration
 *
 * Based on: Opus 256kbps, 20ms frames, 48kHz stereo
 *
 * - Each chunk ≈ 20ms of audio
 * - Initial buffer: 25 chunks (500ms) - larger to handle stream ramp-up
 * - Target: 400ms scheduled ahead during playback
 * - Max buffer: 75 chunks (1.5s) - prevents memory overflow on long streams
 *
 * Startup stuttering fix: FFmpeg/yt-dlp needs time to "prime" the pipeline,
 * so chunks arrive slowly at first. Larger initial buffer smooths this out.
 */
const INITIAL_BUFFER_CHUNKS = 25;  // 25 * 20ms = 500ms (smooth startup)
const MIN_SCHEDULED_AHEAD_SEC = 0.3; // 300ms minimum scheduled ahead
const TARGET_SCHEDULED_AHEAD_SEC = 0.4; // 400ms target
const MAX_BUFFER_CHUNKS = 75; // 1.5 seconds max - prevents memory overflow

export function useAudioPlayer({ onProgress }: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const audioContextRef = useRef<AudioContext | null>(null);
  const decoderRef = useRef<OggOpusDecoder | null>(null);
  const nextPlayTimeRef = useRef(0);
  const playedSecondsRef = useRef(0);
  const initializedRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Buffer management
  const bufferRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  const init = useCallback(async () => {
    if (initializedRef.current) return;

    try {
      audioContextRef.current = new AudioContext({ sampleRate: 48000 });
      decoderRef.current = new OggOpusDecoder({ forceStereo: true });
      await decoderRef.current.ready;
      initializedRef.current = true;
    } catch (err) {
      throw err;
    }
  }, []);

  // Schedule audio buffers to Web Audio API
  const scheduleBuffers = useCallback((audioContext: AudioContext) => {
    const now = audioContext.currentTime;

    // Calculate how far ahead we're scheduled
    let scheduledAhead = nextPlayTimeRef.current - now;

    // If we fell behind, reset timeline smoothly
    if (scheduledAhead < 0) {
      // Don't jump too far ahead - just get back on track
      nextPlayTimeRef.current = now + 0.05; // Small 50ms gap to avoid clicks
      scheduledAhead = 0.05;
    }

    // Schedule buffers until we reach target scheduled ahead time
    // Be more aggressive: schedule up to 2x target if buffer is healthy
    const scheduleTarget = bufferRef.current.length > INITIAL_BUFFER_CHUNKS
      ? TARGET_SCHEDULED_AHEAD_SEC * 1.5  // Buffer healthy: schedule more ahead
      : TARGET_SCHEDULED_AHEAD_SEC;       // Buffer low: normal scheduling

    while (bufferRef.current.length > 0 && scheduledAhead < scheduleTarget) {
      const buffer = bufferRef.current.shift()!;

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(nextPlayTimeRef.current);

      const duration = buffer.duration;
      nextPlayTimeRef.current += duration;
      scheduledAhead += duration;

      playedSecondsRef.current += duration;
      onProgressRef.current?.(playedSecondsRef.current);
    }
  }, []);

  const playChunk = useCallback(async (opusData: Uint8Array) => {
    const decoder = decoderRef.current;
    const audioContext = audioContextRef.current;

    if (!decoder || !audioContext) {
      return;
    }

    try {
      let result = decoder.decode(opusData);
      if (result instanceof Promise) {
        result = await result;
      }

      const { channelData, samplesDecoded } = result;

      if (!channelData || samplesDecoded === 0 || channelData.length < 2) {
        return;
      }

      // Create AudioBuffer
      const buffer = audioContext.createBuffer(2, samplesDecoded, 48000);
      buffer.copyToChannel(new Float32Array(channelData[0]), 0);
      buffer.copyToChannel(new Float32Array(channelData[1]), 1);

      // Add to buffer queue
      bufferRef.current.push(buffer);

      // Prevent buffer overflow - drop oldest frames if too far behind
      // This keeps memory bounded for long streams (2+ hours)
      if (bufferRef.current.length > MAX_BUFFER_CHUNKS) {
        const dropCount = bufferRef.current.length - MAX_BUFFER_CHUNKS;
        bufferRef.current.splice(0, dropCount);
        // Adjust played time to account for dropped frames
        playedSecondsRef.current += dropCount * 0.02; // 20ms per frame
      }

      if (!isPlayingRef.current) {
        // Wait for initial buffer to fill
        if (bufferRef.current.length >= INITIAL_BUFFER_CHUNKS) {
          isPlayingRef.current = true;
          nextPlayTimeRef.current = audioContext.currentTime + MIN_SCHEDULED_AHEAD_SEC;
          scheduleBuffers(audioContext);
        }
      } else {
        // Already playing - schedule new buffer if needed
        scheduleBuffers(audioContext);
      }
    } catch {
      // Decode errors are expected during stream transitions
    }
  }, [scheduleBuffers]);

  const reset = useCallback(() => {
    playedSecondsRef.current = 0;
    nextPlayTimeRef.current = 0;
    bufferRef.current = [];
    isPlayingRef.current = false;
    decoderRef.current?.reset();
  }, []);

  const stop = useCallback(() => {
    reset();

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (decoderRef.current) {
      decoderRef.current.free();
      decoderRef.current = null;
    }

    initializedRef.current = false;
  }, [reset]);

  const isInitialized = useCallback(() => {
    return initializedRef.current;
  }, []);

  return { init, playChunk, reset, stop, isInitialized };
}
