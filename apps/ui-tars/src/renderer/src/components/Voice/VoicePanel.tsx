import { useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, MicOff, Upload, Square, Loader2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { useSetting } from '@renderer/hooks/useSetting';
import { MAX_AUDIO_BYTES } from '@main/shared/voice';
import captureWorklet from './pcm-capture.worklet.js?url';
import { audioMimeType, decodePCM16 } from './audio';

type Props = {
  onTask: (text: string) => Promise<string>;
  onStop: () => Promise<void>;
  onAudioText: (text: string) => void;
  checkReady?: () => Promise<boolean>;
  disabled?: boolean;
};
export function VoicePanel(props: Props) {
  const { settings } = useSetting();
  const [state, setState] = useState('off');
  const [error, setError] = useState('');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const capture = useRef<AudioWorkletNode | null>(null);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const endTime = useRef(0);
  const generation = useRef(0);
  const taskGeneration = useRef(0);
  const locked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const enabled =
    state === 'listening' || state === 'awake' || state === 'connecting';

  function interrupt() {
    for (const source of sources.current) {
      try {
        source.stop();
      } catch {}
    }
    sources.current.clear();
    endTime.current = 0;
    if (mounted.current) setSpeaking(false);
  }
  function release() {
    generation.current++;
    capture.current?.disconnect();
    capture.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    interrupt();
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
  }
  async function stopVoice() {
    release();
    setState('off');
    await window.electron.voice.stop();
  }
  function play(data: string, sampleRate: number) {
    const ctx = context.current;
    if (!ctx || ctx.state === 'closed') return;
    const values = decodePCM16(data);
    if (!values.length || endTime.current - ctx.currentTime > 30) return;
    const buffer = ctx.createBuffer(1, values.length, sampleRate);
    buffer.getChannelData(0).set(values);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const start = Math.max(endTime.current, ctx.currentTime + 0.03);
    endTime.current = start + buffer.duration;
    sources.current.add(source);
    setSpeaking(true);
    source.onended = () => {
      sources.current.delete(source);
      if (!sources.current.size && mounted.current) setSpeaking(false);
    };
    source.start(start);
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.electron.voice.onEvent((event) => {
      if (event.type === 'state') {
        setState(event.state);
        if (event.message) setError(event.message);
        if (event.state === 'off' || event.state === 'error') release();
      }
      if (event.type === 'transcript') {
        if (event.speaker === 'user')
          setHeard((old) => (old + event.text).slice(-700));
        else setReply((old) => (old + event.text).slice(-700));
      }
      if (event.type === 'audio') {
        try {
          play(event.data, event.sampleRate);
        } catch {
          setError('Unable to play Google audio. Reconnect voice.');
        }
      }
      if (event.type === 'interrupted') interrupt();
      if (event.type === 'command') {
        if (event.stop) {
          taskGeneration.current++;
          void callbacks.current
            .onStop()
            .then(() =>
              window.electron.voice.result(event.id, 'The task was stopped.'),
            )
            .catch(() =>
              window.electron.voice.result(
                event.id,
                'Could not stop the task. Use the on-screen stop button.',
              ),
            );
          return;
        }
        if (locked.current) {
          void window.electron.voice.result(
            event.id,
            'A task is still running. Say my name and stop to cancel it, or wait until it finishes.',
          );
          return;
        }
        const token = ++taskGeneration.current;
        locked.current = true;
        setBusy(true);
        void callbacks.current
          .onTask(event.text)
          .then((result) =>
            window.electron.voice.result(
              event.id,
              token === taskGeneration.current ? result : '',
            ),
          )
          .catch(() =>
            window.electron.voice.result(
              event.id,
              'The task could not be completed. Please check the desktop for details.',
            ),
          )
          .finally(() => {
            locked.current = false;
            if (mounted.current) setBusy(false);
          });
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      release();
      void window.electron.voice.stop();
    };
  }, []);

  async function startVoice() {
    setError('');
    setHeard('');
    setReply('');
    if (callbacks.current.checkReady && !(await callbacks.current.checkReady()))
      return;
    const token = ++generation.current;
    setState('connecting');
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation.current !== token) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const ctx = new AudioContext({ sampleRate: 16000 });
      context.current = ctx;
      await ctx.resume();
      await ctx.audioWorklet.addModule(captureWorklet);
      if (generation.current !== token) return;
      const node = new AudioWorkletNode(ctx, 'pcm-capture');
      capture.current = node;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      ctx.createMediaStreamSource(input).connect(node);
      node.connect(silent);
      silent.connect(ctx.destination);
      node.port.onmessage = (event) => {
        // Half-duplex playback avoids the assistant hearing and activating itself.
        if (context.current === ctx && ctx.currentTime > endTime.current + 0.2)
          window.electron.voice.audio(new Uint8Array(event.data));
      };
      input.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (stream.current === input) void stopVoice();
      });
      await window.electron.voice.start();
      if (generation.current !== token) await window.electron.voice.stop();
    } catch (cause) {
      release();
      await window.electron.voice.stop().catch(() => {});
      setState('error');
      setError(
        cause instanceof Error
          ? cause.message
          : 'Microphone or Google Live connection failed.',
      );
    }
  }

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AudioLines className="size-4 text-blue-600" />
        <b>Gemini Live</b>
        <span
          className={`ml-auto flex items-center gap-1 text-xs ${enabled ? 'text-green-700' : 'text-slate-500'}`}
          role="status"
        >
          <span
            className={`size-2 rounded-full ${enabled ? 'animate-pulse bg-green-500' : 'bg-slate-300'}`}
          />
          {speaking
            ? 'Speaking · microphone paused'
            : busy
              ? 'Working · listening for stop'
              : state === 'awake'
                ? 'Awake · say your task'
                : state === 'listening'
                  ? 'Microphone on · awaiting name'
                  : state === 'connecting'
                    ? 'Connecting…'
                    : 'Microphone off'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          type="button"
          variant={enabled ? 'secondary' : 'default'}
          onClick={() => void (enabled ? stopVoice() : startVoice())}
          disabled={props.disabled && !enabled}
        >
          {state === 'connecting' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : enabled ? (
            <MicOff className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
          {enabled ? 'Turn voice off' : 'Enable voice'}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={uploading || props.disabled}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Add audio
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          aria-label="Stop current task"
          onClick={() => {
            interrupt();
            taskGeneration.current++;
            void callbacks.current.onStop();
          }}
        >
          <Square className="size-3" />
          Stop task
        </Button>
        <input
          ref={fileInput}
          className="hidden"
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > MAX_AUDIO_BYTES) {
              setError('Choose an audio file smaller than 10 MB.');
              return;
            }
            setError('');
            setUploading(true);
            try {
              if (
                callbacks.current.checkReady &&
                !(await callbacks.current.checkReady())
              )
                return;
              const text = await window.electron.voice.transcribe(
                new Uint8Array(await file.arrayBuffer()),
                audioMimeType(file),
              );
              callbacks.current.onAudioText(text);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Audio transcription failed.',
              );
            } finally {
              setUploading(false);
            }
          }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Say “{settings.assistantName || 'Gemini'}, open the browser,” or say the
        name and then your task. While enabled, microphone audio is sent to
        Google, including speech before the name. Uploaded audio becomes
        editable text before you send it.
      </p>
      {heard && (
        <p className="mt-2 break-words text-xs text-slate-700">
          <b>You:</b> {heard}
        </p>
      )}
      {reply && (
        <p className="mt-1 break-words text-xs text-blue-800">
          <b>Gemini:</b> {reply}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
