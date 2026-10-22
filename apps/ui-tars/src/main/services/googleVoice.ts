import WebSocket from 'ws';
import type { LocalStore } from '../store/types';
import type { AssistantEvent } from '../shared/assistant';
import { localIntent } from '../shared/assistant';
import { WakeGate } from '../shared/voice';

type Settings = Pick<
  LocalStore,
  | 'vlmApiKey'
  | 'assistantName'
  | 'voiceName'
  | 'speechInputModel'
  | 'speechOutputModel'
>;
export class GoogleVoice {
  private socket?: WebSocket;
  private wanted = false;
  private ready = false;
  private settings?: Settings;
  private gate?: WakeGate;
  private timer?: ReturnType<typeof setTimeout>;
  private settle?: (error?: Error) => void;
  private attempts = 0;
  private speech?: AbortController;
  private epoch = 0;
  private lastEarlyStop = 0;
  constructor(
    private emit: (event: AssistantEvent) => void,
    private heard: (text: string) => void,
    private barge: () => void,
    private makeSocket = (url: string) =>
      new WebSocket(url, { maxPayload: 2 * 1024 * 1024 }),
    private fetcher: typeof fetch = fetch,
  ) {}
  get enabled() {
    return this.wanted;
  }
  async start(settings: Settings) {
    this.stop(true);
    if (!settings.vlmApiKey?.trim())
      throw new Error('Add your Google API key to enable voice.');
    for (const model of [
      settings.speechInputModel || 'gemini-3.5-transcribe-live',
      settings.speechOutputModel || 'gemini-3.8-flash-lite-tts',
    ])
      if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model))
        throw new Error('Choose a valid Google speech model.');
    this.settings = { ...settings };
    this.gate = new WakeGate(settings.assistantName || 'Gemini');
    this.wanted = true;
    this.attempts = 0;
    try {
      await this.connect();
    } catch (e) {
      this.stop();
      throw e;
    }
  }
  private connect(): Promise<void> {
    if (!this.wanted || !this.settings)
      return Promise.reject(new Error('Voice stopped.'));
    this.emit({
      type: 'voice',
      state: 'starting',
      text: this.attempts ? 'Reconnecting to Google…' : 'Connecting to Google…',
    });
    const ws = this.makeSocket(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' +
        encodeURIComponent(this.settings.vlmApiKey),
    );
    this.socket = ws;
    return new Promise((resolve, reject) => {
      this.timer = setTimeout(
        () => this.failed(ws, 'Google speech connection timed out.'),
        15000,
      );
      this.settle = (error) => {
        clearTimeout(this.timer);
        this.settle = undefined;
        error ? reject(error) : resolve();
      };
      ws.on('open', () => {
        if (ws !== this.socket) return;
        ws.send(
          JSON.stringify({
            setup: {
              model:
                'models/' +
                (this.settings!.speechInputModel ||
                  'gemini-3.5-transcribe-live'),
              generationConfig: { responseModalities: ['TEXT'] },
              inputAudioTranscription: {
                languageCodes: [],
                customVocabulary: [this.settings!.assistantName || 'Gemini'],
              },
            },
          }),
        );
      });
      ws.on('message', (raw) => {
        if (this.socket !== ws) return;
        try {
          this.receive(JSON.parse(raw.toString()));
        } catch {
          this.failed(ws, 'Invalid response from Google speech.');
        }
      });
      ws.on('error', () =>
        this.failed(ws, 'Google speech connection interrupted.'),
      );
      ws.on('close', (code) => {
        if (this.socket !== ws) return;
        if (code === 1008 || code === 1007)
          this.failed(
            ws,
            'Google rejected speech access. Check your API key and speech model.',
            false,
          );
        else this.failed(ws, 'Google speech disconnected.');
      });
    });
  }
  private failed(ws: WebSocket, message: string, retry = true) {
    if (ws !== this.socket) return;
    clearTimeout(this.timer);
    const wasReady = this.ready;
    this.socket = undefined;
    this.ready = false;
    this.settle?.(new Error(message));
    ws.terminate();
    this.interrupt();
    if (
      this.wanted &&
      retry &&
      (wasReady || this.attempts > 0) &&
      this.attempts < 3
    ) {
      const delay = 1000 * 2 ** this.attempts++;
      this.emit({
        type: 'voice',
        state: 'starting',
        text: 'Reconnecting to Google…',
      });
      this.timer = setTimeout(() => {
        void this.connect().catch(() => {});
      }, delay);
    } else {
      this.wanted = false;
      this.emit({ type: 'voice', state: 'error', text: message });
    }
  }
  private receive(message: any) {
    if (message.error) {
      this.failed(
        this.socket!,
        'Google speech rejected the session. Check model access and quota.',
        false,
      );
      return;
    }
    if (message.setupComplete) {
      this.ready = true;
      this.settle?.();
      this.emit({ type: 'voice', state: 'listening' });
      // Backoff is reset only after a stable connection, not every reconnect handshake.
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.attempts = 0;
      }, 30000);
    }
    if (message.goAway) {
      this.failed(this.socket!, 'Google speech session ended.');
      return;
    }
    const c = message.serverContent;
    if (!c) return;
    const interim = c.interimInputTranscription?.text;
    if (interim) {
      this.emit({ type: 'voice-transcript', text: interim });
      if (
        ['cancel', 'pause'].includes(
          localIntent(interim, this.settings?.assistantName) || '',
        )
      ) {
        this.lastEarlyStop = Date.now();
        this.heard(interim);
      }
    }
    const text = c.inputTranscription?.text?.trim();
    if (!text) return;
    this.emit({ type: 'voice-transcript', text });
    const local = localIntent(text, this.settings?.assistantName);
    if (local) {
      if (
        !(
          ['cancel', 'pause'].includes(local) &&
          Date.now() - this.lastEarlyStop < 2000
        )
      )
        this.heard(text);
      return;
    }
    const result = this.gate?.consume(text);
    if (result?.kind === 'wake') {
      this.speak('I am listening.');
      return;
    }
    if (result?.kind === 'task' || result?.kind === 'stop') {
      this.barge();
      this.heard(result.text);
    }
  }
  audio(bytes: Uint8Array) {
    if (
      !this.ready ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !bytes.byteLength ||
      bytes.byteLength > 32000 ||
      bytes.byteLength % 2 ||
      this.socket.bufferedAmount > 64000
    )
      return;
    this.socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: Buffer.from(bytes).toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        },
      }),
    );
  }
  interrupt() {
    this.epoch++;
    this.speech?.abort();
    this.speech = undefined;
    this.emit({ type: 'voice-interrupt' });
  }
  speak(text: string) {
    if (!this.wanted || !this.settings || !text.trim()) return;
    this.interrupt();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.speech = controller;
    const settings = this.settings;
    this.emit({ type: 'voice-speaking', state: 'preparing' });
    void (async () => {
      let settle: ((tokens?: number) => void) | undefined;
      try {
        const { getGoogleRestQuota } = await import('@ui-tars/sdk/core');
        const model = settings.speechOutputModel || 'gemini-3.8-flash-lite-tts';
        const spoken = text
          .replace(
            /\x60{3}[\s\S]*?\x60{3}/g,
            ' Code is shown in the conversation. ',
          )
          .replace(/[*#\x60]/g, '')
          .slice(0, 6000);
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(45000),
        ]);
        settle = await getGoogleRestQuota(settings.vlmApiKey, model).reserve(
          Math.min(15000, Math.ceil(spoken.length * 2.3) + 256),
          signal,
        );
        signal.throwIfAborted();
        const response = await this.fetcher(
          'https://generativelanguage.googleapis.com/v1beta/interactions',
          {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': settings.vlmApiKey,
            },
            body: JSON.stringify({
              model,
              input: [
                {
                  type: 'user_input',
                  content: [
                    {
                      type: 'text',
                      text: spoken,
                      annotations: [
                        {
                          type: 'speech_metadata',
                          style:
                            'Natural, clear, conversational. Calm and concise.',
                        },
                      ],
                    },
                  ],
                },
              ],
              response_format: { type: 'audio' },
              generation_config: {
                speech_config: [{ voice: settings.voiceName || 'Aoede' }],
              },
            }),
          },
        );
        if (!response.ok) {
          if (response.status === 429)
            getGoogleRestQuota(settings.vlmApiKey, model).cooldown(60000);
          await response.body?.cancel();
          throw new Error(
            'Google voice generation failed (' +
              response.status +
              '). Your text response is still available.',
          );
        }
        const body = await response.json();
        signal.throwIfAborted();
        const audio =
          body.steps
            ?.filter((s: any) => s.type === 'model_output')
            .flatMap((s: any) => s.content || [])
            .findLast((c: any) => c.type === 'audio') || body.output_audio;
        if (
          !audio?.data ||
          typeof audio.data !== 'string' ||
          audio.data.length > 12 * 1024 * 1024
        )
          throw new Error('Google returned missing or oversized voice audio.');
        if (epoch === this.epoch && this.wanted)
          this.emit({
            type: 'voice-audio',
            data: audio.data,
            mimeType: audio.mime_type || 'audio/wav',
            epoch,
          });
        settle(body.usage?.total_tokens);
      } catch (error) {
        if (!controller.signal.aborted && epoch === this.epoch) {
          this.emit({
            type: 'error',
            id: '',
            text:
              error instanceof Error ? error.message : 'Google voice failed.',
          });
          this.emit({ type: 'voice-speaking', state: 'idle' });
        }
      } finally {
        settle?.();
        if (this.speech === controller) this.speech = undefined;
      }
    })();
  }
  stop(silent = false) {
    this.wanted = false;
    this.ready = false;
    clearTimeout(this.timer);
    this.settle?.(new Error('Voice connection cancelled.'));
    const ws = this.socket;
    this.socket = undefined;
    ws?.terminate();
    this.gate?.reset();
    this.interrupt();
    if (!silent) this.emit({ type: 'voice', state: 'off' });
  }
}
