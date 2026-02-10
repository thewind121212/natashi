import { useRef, useCallback } from 'react';
import type { OggOpusDecoder } from 'ogg-opus-decoder';

interface UseAudioPlayerOptions {
  onProgress?: (seconds: number) => void;
}

interface UseAudioPlayerReturn {
  init: () => Promise<void>;
  playChunk: (opusData: Uint8Array) => Promise<void>;
  reset: () => void;
  stop: () => void;
  isInitialized: () => boolean;
  setVolume: (value: number) => void;
  getVolume: () => number;
}

/**
 * Audio Buffer Configuration
 *
 * Based on: Opus 256kbps, 20ms frames, 48kHz stereo
 *
 * - Initial buffer: 350-400ms for fast start + stability
 * - Target: 400ms scheduled ahead during playback
 * - Max buffer: 1.5s - prevents memory overflow on long streams
 *
 * Startup stuttering fix: FFmpeg/yt-dlp needs time to "prime" the pipeline,
 * so chunks arrive slowly at first. Larger initial buffer smooths this out.
 */
const INITIAL_BUFFER_SECONDS = 0.5;  // 500ms (stable on low-power clients)
const MIN_SCHEDULED_AHEAD_SEC = 0.4; // 400ms minimum scheduled ahead
const TARGET_SCHEDULED_AHEAD_SEC = 0.6; // 600ms target
const MAX_BUFFER_SECONDS = 2.0; // 2 seconds max - prevents memory overflow

export function useAudioPlayer({ onProgress }: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const audioContextRef = useRef<AudioContext | null>(null);
  const decoderRef = useRef<OggOpusDecoder | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const volumeRef = useRef(1.0); // Store volume for getVolume
  const nextPlayTimeRef = useRef(0);
  const playedSecondsRef = useRef(0);
  const bufferedSecondsRef = useRef(0);
  const initializedRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Buffer management
  const bufferRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const lastProgressNotifyRef = useRef(0);

  const init = useCallback(async () => {
    if (initializedRef.current) return;

    audioContextRef.current = new AudioContext({ sampleRate: 48000 });

    // Create GainNode for volume control
    gainNodeRef.current = audioContextRef.current.createGain();
    gainNodeRef.current.gain.value = volumeRef.current;
    gainNodeRef.current.connect(audioContextRef.current.destination);

    const { OggOpusDecoder } = await import('ogg-opus-decoder');
    decoderRef.current = new OggOpusDecoder({ forceStereo: true });
    await decoderRef.current.ready;
    initializedRef.current = true;
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
    const scheduleTarget = bufferedSecondsRef.current > INITIAL_BUFFER_SECONDS
      ? TARGET_SCHEDULED_AHEAD_SEC * 1.5  // Buffer healthy: schedule more ahead
      : TARGET_SCHEDULED_AHEAD_SEC;       // Buffer low: normal scheduling

    while (bufferRef.current.length > 0 && scheduledAhead < scheduleTarget) {
      const buffer = bufferRef.current.shift()!;
      bufferedSecondsRef.current -= buffer.duration;
      if (bufferedSecondsRef.current < 0) {
        bufferedSecondsRef.current = 0;
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      // Connect through GainNode for volume control
      if (gainNodeRef.current) {
        source.connect(gainNodeRef.current);
      } else {
        source.connect(audioContext.destination);
      }
      source.start(nextPlayTimeRef.current);

      const duration = buffer.duration;
      nextPlayTimeRef.current += duration;
      scheduledAhead += duration;

      playedSecondsRef.current += duration;
    }

    // Throttle UI progress updates to ~4x/sec instead of every 20ms frame
    const progressNow = performance.now();
    if (progressNow - lastProgressNotifyRef.current > 250) {
      lastProgressNotifyRef.current = progressNow;
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
      bufferedSecondsRef.current += buffer.duration;

      // Prevent buffer overflow - drop oldest frames if too far behind
      // This keeps memory bounded for long streams (2+ hours)
      if (bufferedSecondsRef.current > MAX_BUFFER_SECONDS) {
        let droppedSeconds = 0;
        while (bufferRef.current.length > 0 && bufferedSecondsRef.current > MAX_BUFFER_SECONDS) {
          const dropped = bufferRef.current.shift()!;
          bufferedSecondsRef.current -= dropped.duration;
          droppedSeconds += dropped.duration;
        }
        if (bufferedSecondsRef.current < 0) {
          bufferedSecondsRef.current = 0;
        }
        // Adjust played time to account for dropped audio
        playedSecondsRef.current += droppedSeconds;
      }

      if (!isPlayingRef.current) {
        // Wait for initial buffer to fill
        if (bufferedSecondsRef.current >= INITIAL_BUFFER_SECONDS) {
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
    bufferedSecondsRef.current = 0;
    isPlayingRef.current = false;
    lastProgressNotifyRef.current = 0;
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

    gainNodeRef.current = null;
    initializedRef.current = false;
  }, [reset]);

  const isInitialized = useCallback(() => {
    return initializedRef.current;
  }, []);

  // Volume control with smooth transition to avoid clicks
  const setVolume = useCallback((value: number) => {
    const clampedValue = Math.max(0, Math.min(1, value));
    volumeRef.current = clampedValue;

    if (gainNodeRef.current && audioContextRef.current) {
      // Use setTargetAtTime for smooth transition (10ms time constant)
      gainNodeRef.current.gain.setTargetAtTime(
        clampedValue,
        audioContextRef.current.currentTime,
        0.01
      );
    }
  }, []);

  const getVolume = useCallback(() => {
    return volumeRef.current;
  }, []);

  return { init, playChunk, reset, stop, isInitialized, setVolume, getVolume };
}
