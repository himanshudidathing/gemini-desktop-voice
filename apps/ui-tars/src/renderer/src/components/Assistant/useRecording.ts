import { useCallback, useEffect, useRef, useState } from 'react';
export function useRecording(onError: (text: string) => void) {
  const [state, setState] = useState<
    'off' | 'starting' | 'recording' | 'saving'
  >('off');
  const epoch = useRef(0),
    pending = useRef(false);
  const current = useRef<
    | {
        recorder: MediaRecorder;
        stream: MediaStream;
        id: string;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined
  >(undefined);
  const errors = useRef(onError);
  errors.current = onError;
  const stop = useCallback(() => {
    epoch.current++;
    pending.current = false;
    const r = current.current;
    if (r) {
      clearTimeout(r.timer);
      if (r.recorder.state !== 'inactive') r.recorder.stop();
      r.stream.getTracks().forEach((t) => t.stop());
      setState('saving');
    } else setState('off');
  }, []);
  const start = useCallback(async () => {
    if (pending.current || current.current) return;
    pending.current = true;
    const token = ++epoch.current;
    setState('starting');
    let stream: MediaStream | undefined, id: string | undefined;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          frameRate: 20,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (token !== epoch.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      id = await window.electron.assistant.startRecording();
      if (token !== epoch.current) {
        stream.getTracks().forEach((t) => t.stop());
        await window.electron.assistant.finishRecording(id);
        return;
      }
      const mimeType = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) throw new Error('WebM recording is unavailable.');
      const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2500000,
        }),
        recordingId = id;
      let tail = Promise.resolve(),
        buffered = 0,
        failed = false;
      const fail = (error: unknown) => {
        if (!failed) {
          failed = true;
          errors.current(
            error instanceof Error ? error.message : 'Recording failed.',
          );
        }
        stop();
      };
      recorder.ondataavailable = (event) => {
        if (!event.data.size || failed) return;
        buffered += event.data.size;
        if (buffered > 16 * 1024 * 1024) {
          fail(
            new Error(
              'Disk writes are too slow. Recording stopped to protect memory.',
            ),
          );
          return;
        }
        tail = tail
          .then(async () => {
            await window.electron.assistant.appendRecording(
              recordingId,
              new Uint8Array(await event.data.arrayBuffer()),
            );
          })
          .catch(fail)
          .finally(() => {
            buffered -= event.data.size;
          });
      };
      recorder.onerror = () =>
        fail(new Error('Screen recording was interrupted.'));
      recorder.onstop = () => {
        if (current.current?.id === recordingId) {
          clearTimeout(current.current.timer);
          current.current.stream.getTracks().forEach((t) => t.stop());
        }
        void tail
          .then(() => window.electron.assistant.finishRecording(recordingId))
          .catch((e) => errors.current(e.message || String(e)))
          .finally(() => {
            if (current.current?.id === recordingId)
              current.current = undefined;
            setState('off');
          });
      };
      stream.getVideoTracks()[0].onended = stop;
      current.current = {
        recorder,
        stream,
        id,
        timer: setTimeout(stop, 600000),
      };
      recorder.start(1000);
      setState('recording');
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      if (id)
        await window.electron.assistant.finishRecording(id).catch(() => {});
      if (token === epoch.current) {
        setState('off');
        errors.current(
          error instanceof Error ? error.message : 'Could not start recording.',
        );
      }
    } finally {
      if (token === epoch.current) pending.current = false;
    }
  }, [stop]);
  useEffect(() => () => stop(), [stop]);
  return { state, start, stop };
}
