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

export function useAudioPlayer({ onProgress }: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const audioContextRef = useRef<AudioContext | null>(null);
  const decoderRef = useRef<OggOpusDecoder | null>(null);
  const nextPlayTimeRef = useRef(0);
  const playedSecondsRef = useRef(0);
  const initializedRef = useRef(false);

  const init = useCallback(async () => {
    if (initializedRef.current) return;

    try {
      // Create AudioContext (requires user gesture)
      audioContextRef.current = new AudioContext({ sampleRate: 48000 });

      // Create OGG Opus decoder (handles OGG container format from FFmpeg)
      decoderRef.current = new OggOpusDecoder({
        forceStereo: true,
      });
      await decoderRef.current.ready;

      initializedRef.current = true;
    } catch (err) {
      throw err;
    }
  }, []);

  const chunkCountRef = useRef(0);

  const playChunk = useCallback(async (opusData: Uint8Array) => {
    const decoder = decoderRef.current;
    const audioContext = audioContextRef.current;

    if (!decoder || !audioContext) {
      return;
    }

    chunkCountRef.current++;

    try {
      // Decode OGG Opus to PCM (may be async in browser)
      let result = decoder.decode(opusData);
      if (result instanceof Promise) {
        result = await result;
      }

      const { channelData, samplesDecoded } = result;

      if (!channelData || samplesDecoded === 0) {
        // OGG decoder may need more data to produce output
        return;
      }

      if (samplesDecoded > 0 && channelData.length >= 2) {
        // Create AudioBuffer
        const buffer = audioContext.createBuffer(
          2, // stereo
          samplesDecoded,
          48000
        );
        buffer.copyToChannel(new Float32Array(channelData[0]), 0);
        buffer.copyToChannel(new Float32Array(channelData[1]), 1);

        // Create and schedule buffer source
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);

        // Schedule playback (gapless)
        const now = audioContext.currentTime;
        if (nextPlayTimeRef.current < now) {
          nextPlayTimeRef.current = now;
        }
        source.start(nextPlayTimeRef.current);
        nextPlayTimeRef.current += samplesDecoded / 48000;

        // Update progress
        playedSecondsRef.current += samplesDecoded / 48000;
        onProgress?.(playedSecondsRef.current);
      }
    } catch {
      // Decode errors are expected during stream transitions
    }
  }, [onProgress]);

  const reset = useCallback(() => {
    playedSecondsRef.current = 0;
    nextPlayTimeRef.current = 0;
    chunkCountRef.current = 0;

    // Reset decoder state for clean start (async but we don't wait)
    decoderRef.current?.reset();
  }, []);

  const stop = useCallback(() => {
    reset();

    // Close AudioContext to stop any scheduled audio
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Free decoder resources
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
