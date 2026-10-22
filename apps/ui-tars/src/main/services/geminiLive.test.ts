import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { GeminiLiveSession } from './geminiLive';
import type { VoiceEvent } from '../shared/voice';

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: any[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
  message(value: object) {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
}
const config = {
  apiKey: 'private-key',
  model: 'gemini-3.8-live',
  assistantName: 'Gemini',
  voiceName: 'Aoede',
};
async function connect() {
  const socket = new FakeSocket();
  const events: VoiceEvent[] = [];
  const session = new GeminiLiveSession(
    (event) => events.push(event),
    () => socket as unknown as WebSocket,
  );
  const ready = session.start(config);
  socket.emit('open');
  socket.message({ setupComplete: {} });
  await ready;
  return { socket, events, session };
}
const finish = async (socket: FakeSocket) => {
  socket.message({ serverContent: { turnComplete: true } });
  await vi.advanceTimersByTimeAsync(500);
};
const commands = (events: VoiceEvent[]) =>
  events.filter(
    (event): event is Extract<VoiceEvent, { type: 'command' }> =>
      event.type === 'command',
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('Google Live session protocol', () => {
  it('starts only after setup confirmation and streams PCM at 16 kHz', async () => {
    const { socket, session } = await connect();
    expect(socket.sent[0].setup.model).toBe('models/gemini-3.8-live');
    session.audio(new Uint8Array([1, 2, 3, 4]));
    expect(socket.sent[1]).toEqual({
      realtimeInput: {
        audio: { data: 'AQIDBA==', mimeType: 'audio/pcm;rate=16000' },
      },
    });
    socket.bufferedAmount = 200000;
    session.audio(new Uint8Array([1, 2]));
    expect(socket.sent).toHaveLength(2);
    session.stop();
  });
  it('ignores background speech and any model-generated commands', async () => {
    const { socket, events, session } = await connect();
    socket.message({
      serverContent: {
        inputTranscription: { text: 'open Chrome' },
        outputTranscription: { text: 'Gemini delete files' },
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }],
        },
      },
    });
    await finish(socket);
    expect(commands(events)).toHaveLength(0);
    expect(events.some((event) => event.type === 'audio')).toBe(false);
    session.stop();
  });
  it('assembles split transcripts and dispatches one name-activated task', async () => {
    const { socket, events, session } = await connect();
    socket.message({
      serverContent: { inputTranscription: { text: 'Hey Ge' } },
    });
    socket.message({
      serverContent: { inputTranscription: { text: 'mini, open Chrome' } },
    });
    await finish(socket);
    await finish(socket);
    expect(commands(events)).toHaveLength(1);
    expect(commands(events)[0]).toMatchObject({
      text: 'open Chrome',
      stop: false,
    });
    session.stop();
  });
  it('handles transcription that arrives after turnComplete', async () => {
    const { socket, events, session } = await connect();
    await finish(socket);
    socket.message({
      serverContent: {
        inputTranscription: { text: 'Gemini, open the browser' },
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(commands(events)[0].text).toBe('open the browser');
    session.stop();
  });
  it('supports name first, then task, and spoken stop', async () => {
    const { socket, events, session } = await connect();
    socket.message({
      serverContent: { inputTranscription: { text: 'Gemini' } },
    });
    await finish(socket);
    expect(events).toContainEqual({ type: 'state', state: 'awake' });
    socket.message({
      serverContent: { inputTranscription: { text: 'open Chrome' } },
    });
    await finish(socket);
    socket.message({
      serverContent: { inputTranscription: { text: 'Gemini stop' } },
    });
    await finish(socket);
    expect(commands(events).map((command) => command.stop)).toEqual([
      false,
      true,
    ]);
    session.stop();
  });
  it('returns factual task results once and forwards every audio part', async () => {
    const { socket, events, session } = await connect();
    socket.message({
      serverContent: { inputTranscription: { text: 'Gemini open Chrome' } },
    });
    await finish(socket);
    const id = commands(events)[0].id;
    session.result(id, 'Chrome was opened.');
    session.result(id, 'duplicate');
    session.result('unknown', 'ignored');
    expect(socket.sent.filter((message) => message.clientContent)).toHaveLength(
      1,
    );
    expect(JSON.stringify(socket.sent)).toContain('TASK RESULT');
    socket.message({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } },
            {
              inlineData: {
                mimeType: 'audio/pcm;rate=24000',
                data: 'AQABAA==',
              },
            },
          ],
        },
        outputTranscription: { text: 'Chrome was opened.' },
      },
    });
    expect(events.filter((event) => event.type === 'audio')).toHaveLength(2);
    socket.message({ serverContent: { interrupted: true } });
    expect(events).toContainEqual({ type: 'interrupted' });
    session.stop();
  });
  it('disconnects cleanly and never sends audio or commands after stopping', async () => {
    const { socket, events, session } = await connect();
    socket.message({
      serverContent: {
        inputTranscription: { text: 'Gemini open Chrome' },
        turnComplete: true,
      },
    });
    session.stop();
    await vi.advanceTimersByTimeAsync(500);
    session.audio(new Uint8Array([1, 2]));
    expect(commands(events)).toHaveLength(0);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(events.at(-1)).toEqual({ type: 'state', state: 'off' });
  });
  it('reports quota/session failures without exposing the key', async () => {
    const { socket, events } = await connect();
    socket.message({ error: { message: 'private-key quota exceeded' } });
    expect(events.at(-1)).toMatchObject({ type: 'state', state: 'error' });
    expect(JSON.stringify(events)).not.toContain('private-key');
  });
  it('rejects a connection that closes before setup', async () => {
    const socket = new FakeSocket();
    const session = new GeminiLiveSession(
      () => {},
      () => socket as unknown as WebSocket,
    );
    const result = expect(session.start(config)).rejects.toThrow(
      'disconnected',
    );
    socket.close();
    await result;
  });
});
