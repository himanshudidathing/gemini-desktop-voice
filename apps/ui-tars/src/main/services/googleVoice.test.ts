import { EventEmitter } from 'node:events';
import { vi, beforeEach, afterEach, expect, it } from 'vitest';
const quota = vi.hoisted(() => ({
  reserve: vi.fn(async (_n, _s) => vi.fn()),
  cooldown: vi.fn(),
}));
vi.mock('@ui-tars/sdk/core', () => ({ getGoogleRestQuota: () => quota }));
import { GoogleVoice } from './googleVoice';
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  terminate() {
    this.readyState = 3;
  }
  message(value: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
}
const settings = {
  vlmApiKey: 'google-test',
  assistantName: 'Gemini',
  voiceName: 'Aoede' as const,
  speechInputModel: 'gemini-3.5-transcribe-live',
  speechOutputModel: 'gemini-3.8-flash-lite-tts',
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup(fetcher: any = vi.fn()) {
  const events: any[] = [],
    heard = vi.fn(),
    barge = vi.fn(),
    sockets: Socket[] = [];
  const voice = new GoogleVoice(
    (e) => events.push(e),
    heard,
    barge,
    () => {
      const s = new Socket();
      sockets.push(s);
      return s as any;
    },
    fetcher,
  );
  const pending = voice.start(settings);
  sockets[0].emit('open');
  sockets[0].message({ setupComplete: {} });
  await pending;
  return { voice, events, heard, barge, sockets };
}
it('opens Google transcription-only streaming and forwards PCM microphone audio', async () => {
  const t = await setup();
  const ws = t.sockets[0];
  expect(ws.sent[0].setup.model).toBe('models/gemini-3.5-transcribe-live');
  expect(ws.sent[0].setup.generationConfig.responseModalities).toEqual([
    'TEXT',
  ]);
  t.voice.audio(new Uint8Array([0, 0, 1, 0]));
  expect(ws.sent[1].realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
  t.voice.stop();
});
it('routes local stop without a wake name and gates ordinary background speech', async () => {
  const t = await setup();
  t.sockets[0].message({
    serverContent: { inputTranscription: { text: 'background conversation' } },
  });
  expect(t.heard).not.toHaveBeenCalled();
  t.sockets[0].message({
    serverContent: { interimInputTranscription: { text: 'Stop' } },
  });
  t.sockets[0].message({
    serverContent: { inputTranscription: { text: 'Stop' } },
  });
  expect(t.heard).toHaveBeenCalledTimes(1);
  t.sockets[0].message({
    serverContent: {
      inputTranscription: { text: 'Gemini, explain this code' },
    },
  });
  expect(t.heard).toHaveBeenLastCalledWith('explain this code');
  expect(t.barge).toHaveBeenCalledOnce();
  t.voice.stop();
});
it('sends model text to Google TTS and publishes the returned audio', async () => {
  const fetcher = vi.fn(
    async (_url: unknown, _options: any) =>
      new Response(
        JSON.stringify({
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'audio', mime_type: 'audio/wav', data: 'UklGRg==' },
              ],
            },
          ],
        }),
      ),
  );
  const t = await setup(fetcher);
  t.voice.speak('Here is the answer from Groq.');
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.model).toBe('gemini-3.8-flash-lite-tts');
  expect(body.input[0].content[0].text).toBe('Here is the answer from Groq.');
  expect(t.events.some((e) => e.type === 'voice-audio')).toBe(true);
  t.voice.stop();
});
it('aborts TTS and discards audio arriving after interruption', async () => {
  let resolve!: Function;
  const fetcher = vi.fn((_url, _options) => new Promise((r) => (resolve = r)));
  const t = await setup(fetcher);
  t.voice.speak('A long answer');
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
  t.voice.interrupt();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(
    new Response(
      JSON.stringify({
        steps: [
          { type: 'model_output', content: [{ type: 'audio', data: 'AA==' }] },
        ],
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(t.events.filter((e) => e.type === 'voice-audio')).toHaveLength(0);
  t.voice.stop();
});
it('reconnects a dropped established session and cancels reconnect on disable', async () => {
  const t = await setup();
  t.sockets[0].emit('close', 1006);
  await vi.advanceTimersByTimeAsync(1000);
  expect(t.sockets).toHaveLength(2);
  t.voice.stop();
  await vi.advanceTimersByTimeAsync(20000);
  expect(t.sockets).toHaveLength(2);
  expect(t.voice.enabled).toBe(false);
});
it('rejects missing Google voice credentials even when other providers may be available', async () => {
  const voice = new GoogleVoice(vi.fn(), vi.fn(), vi.fn(), vi.fn());
  await expect(voice.start({ ...settings, vlmApiKey: '' })).rejects.toThrow(
    'Google API key',
  );
});
