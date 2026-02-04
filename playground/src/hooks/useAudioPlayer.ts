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
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

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

      const duration = samplesDecoded / 48000;
      const now = audioContext.currentTime;

      // Schedule with lead time to handle chunk bursts from server
      if (nextPlayTimeRef.current < now + 0.1) {
        nextPlayTimeRef.current = now + 0.1;
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(nextPlayTimeRef.current);

      nextPlayTimeRef.current += duration;
      playedSecondsRef.current += duration;
      onProgressRef.current?.(playedSecondsRef.current);
    } catch {
      // Decode errors are expected during stream transitions
    }
  }, []);

  const reset = useCallback(() => {
    playedSecondsRef.current = 0;
    nextPlayTimeRef.current = 0;
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
