import { useCallback, useEffect, useRef, useState } from 'react';
import captureWorklet from '../Voice/pcm-capture.worklet.js?url';

/** Google owns recognition and synthesis; this hook owns microphone and cancellable playback. */
export function useGoogleVoice(onError: (message: string) => void) {
  const api = window.electron.assistant;
  const [state, setState] = useState<
    'off' | 'starting' | 'listening' | 'error'
  >('off');
  const [speaking, setSpeaking] = useState<'idle' | 'preparing' | 'playing'>(
    'idle',
  );
  const [level, setLevel] = useState(0),
    [transcript, setTranscript] = useState('');
  const errors = useRef(onError);
  errors.current = onError;
  const enabled = useRef(false),
    generation = useRef(0),
    playback = useRef(0);
  const stream = useRef<MediaStream | undefined>(undefined),
    context = useRef<AudioContext | undefined>(undefined),
    capture = useRef<AudioWorkletNode | undefined>(undefined);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const interrupt = useCallback(() => {
    playback.current++;
    for (const source of sources.current) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    sources.current.clear();
    setSpeaking('idle');
  }, []);
  const release = useCallback(() => {
    generation.current++;
    enabled.current = false;
    capture.current?.disconnect();
    capture.current = undefined;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = undefined;
    interrupt();
    void context.current?.close().catch(() => {});
    context.current = undefined;
    setLevel(0);
  }, [interrupt]);
  const stop = useCallback(async () => {
    release();
    setState('off');
    await api.stopVoice();
  }, [api, release]);
  const start = useCallback(async () => {
    if (enabled.current) return;
    enabled.current = true;
    const token = ++generation.current;
    setState('starting');
    setTranscript('');
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (token !== generation.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const ctx = new AudioContext({ sampleRate: 16000 });
      context.current = ctx;
      await ctx.resume();
      await ctx.audioWorklet.addModule(captureWorklet);
      if (token !== generation.current) return;
      const node = new AudioWorkletNode(ctx, 'pcm-capture');
      capture.current = node;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      ctx.createMediaStreamSource(input).connect(node);
      node.connect(silent);
      silent.connect(ctx.destination);
      let activeFrames = 0,
        quietFrames = 0,
        inUtterance = false;
      node.port.onmessage = (event) => {
        if (token !== generation.current) return;
        const bytes = new Uint8Array(event.data),
          pcm = new DataView(bytes.buffer);
        let square = 0;
        for (let i = 0; i < bytes.length; i += 2)
          square += (pcm.getInt16(i, true) / 32768) ** 2;
        const rms = Math.sqrt(square / (bytes.length / 2));
        setLevel(Math.min(1, rms * 8));
        if (rms > 0.028) {
          activeFrames++;
          quietFrames = 0;
        } else {
          quietFrames++;
          activeFrames = 0;
        }
        if (activeFrames >= 2 && !inUtterance) {
          inUtterance = true;
          interrupt();
          void api.bargeIn().catch((e) => errors.current(e.message));
        }
        if (quietFrames >= 5) inUtterance = false;
        // Keep sending while playing. Browser acoustic echo cancellation permits barge-in.
        api.voiceAudio(bytes);
      };
      input.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (token === generation.current)
          void stop().catch((e) => errors.current(e.message));
      });
      await api.startVoice();
      if (token !== generation.current) await api.stopVoice();
    } catch (error) {
      if (token === generation.current) {
        release();
        setState('error');
        errors.current(
          error instanceof Error
            ? error.message
            : 'Google voice could not start.',
        );
        await api.stopVoice().catch(() => {});
      }
    }
  }, [api, interrupt, release, stop]);
  const toggle = useCallback(
    () => (enabled.current ? stop() : start()),
    [start, stop],
  );
  useEffect(() => {
    const off = api.onEvent((event) => {
      if (event.type === 'voice-control') {
        const task =
          event.action === 'off'
            ? stop()
            : event.action === 'on'
              ? start()
              : toggle();
        void task.catch((e) => errors.current(e.message));
      }
      if (event.type === 'voice') {
        setState(event.state);
        if (event.state === 'off' || event.state === 'error') release();
        if (event.state === 'error')
          errors.current(event.text || 'Google voice disconnected.');
      }
      if (event.type === 'voice-transcript') setTranscript(event.text);
      if (event.type === 'voice-interrupt') interrupt();
      if (event.type === 'voice-speaking') setSpeaking(event.state);
      if (event.type === 'voice-audio') {
        const ctx = context.current,
          token = playback.current;
        if (!ctx || !enabled.current) return;
        const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
        void ctx
          .decodeAudioData(bytes.buffer)
          .then((buffer) => {
            if (
              ctx !== context.current ||
              token !== playback.current ||
              !enabled.current
            )
              return;
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            sources.current.add(source);
            source.onended = () => {
              source.disconnect();
              sources.current.delete(source);
              if (!sources.current.size) setSpeaking('idle');
            };
            setSpeaking('playing');
            source.start();
          })
          .catch(() => {
            if (token === playback.current) {
              setSpeaking('idle');
              errors.current(
                'Could not play Google voice audio. The text response is available.',
              );
            }
          });
      }
    });
    return () => {
      off();
      release();
      void api.stopVoice().catch(() => {});
    };
  }, [api, interrupt, release, start, stop, toggle]);
  return { state, speaking, level, transcript, toggle, stop, interrupt };
}
