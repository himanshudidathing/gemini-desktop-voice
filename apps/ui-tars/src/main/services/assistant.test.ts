import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  events: [] as any[],
  callbacks: new Map<string, Function>(),
  settings: {
    vlmApiKey: '',
    vlmModelName: 'gemma-4-31b-it',
    assistantName: 'Gemini',
  },
  state: {
    abortController: null,
    thinking: false,
    messages: [],
    sessionHistoryMessages: [],
  } as any,
  generate: vi.fn(),
  capture: vi.fn(),
  speechStop: vi.fn(),
  agentStop: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: {
    handle: (name: string, fn: Function) => mocks.handlers.set(name, fn),
  },
}));
vi.mock('../env', () => ({ rendererUrl: '' }));
vi.mock('../store/setting', () => ({
  SettingStore: { getStore: () => mocks.settings },
}));
vi.mock('../store/create', () => ({
  store: {
    getState: () => mocks.state,
    setState: (value: object) => Object.assign(mocks.state, value),
  },
}));
vi.mock('../ipcRoutes/agent', () => ({
  GUIAgentManager: {
    getInstance: () => ({ getAgent: () => ({ stop: mocks.agentStop }) }),
  },
}));
vi.mock('@ui-tars/sdk/core', () => ({
  googleRoutedGenerate: mocks.generate,
  getGoogleRestQuota: () => ({
    snapshot: () => ({ requests: 0, tokens: 0, queued: 0, waitMs: 0 }),
  }),
}));
vi.mock('./localMedia', () => ({
  takeScreenshot: mocks.capture,
  screenshotPart: () => ({
    inlineData: { mimeType: 'image/jpeg', data: 'AA==' },
  }),
  beginRecording: vi.fn(),
  appendRecording: vi.fn(),
  finishRecording: vi.fn(async () => null),
  currentRecordingId: vi.fn(() => undefined),
  revealArtifact: vi.fn(),
}));
vi.mock('./localSpeech', () => ({
  LocalSpeech: class {
    enabled = false;
    start() {
      this.enabled = true;
    }
    stop() {
      this.enabled = false;
    }
    interrupt = mocks.speechStop;
    speak = vi.fn();
  },
}));
vi.mock('./audioTranscription', () => ({ transcribeAudio: vi.fn() }));
import { registerAssistantHandlers } from './assistant';
import { operations } from './operations';
const frame = { url: 'file:///assistant.html' };
const owner = {
  mainFrame: frame,
  isDestroyed: () => false,
  send: (_name: string, event: any) => mocks.events.push(event),
  once: vi.fn(),
  on: vi.fn(),
};
const win = {
  webContents: owner,
  minimize: vi.fn(),
  on: vi.fn(),
  hide: vi.fn(),
  getBounds: () => ({ width: 460 }),
};
const invoke = (name: string, ...args: any[]) =>
  mocks.handlers.get('assistant:' + name)!(
    { sender: owner, senderFrame: frame },
    ...args,
  );
const req = (text: string, id = 'request') => ({ id, text, mode: 'auto' });
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.events = [];
  mocks.handlers.clear();
  mocks.settings.vlmApiKey = '';
  mocks.state = {
    abortController: null,
    thinking: false,
    messages: [],
    sessionHistoryMessages: [],
  };
  registerAssistantHandlers(win as any);
});
afterEach(() => {
  operations.cancelAll();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('assistant IPC integration', () => {
  it.each([
    'stop',
    'pause',
    'can you hear me',
    'open settings',
    'toggle microphone',
    'minimize sidebar',
    'clear conversation',
    'what time is it',
    'start screen recording',
    'stop screen recording',
  ])('handles %s without a key or model invocation', async (text) => {
    expect(await invoke('submit', req(text))).toEqual({ local: true });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('captures and saves locally without any model invocation', async () => {
    mocks.capture.mockResolvedValue({
      id: 'shot',
      kind: 'screenshot',
      name: 'test.png',
      path: 'test.png',
    });
    await invoke('submit', req('take screenshot'));
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.events.some((e) => e.type === 'artifact')).toBe(true);
  });
  it('cancels the active request synchronously and suppresses late output', async () => {
    mocks.settings.vlmApiKey = 'test';
    let resolve!: (data: any) => void;
    let request: any;
    mocks.generate.mockImplementation((r) => {
      request = r;
      return new Promise((res) => (resolve = res));
    });
    await invoke('submit', req('hello'));
    await vi.dynamicImportSettled();
    expect(request.signal.aborted).toBe(false);
    await invoke('submit', req('stop', 'stop'));
    expect(request.signal.aborted).toBe(true);
    expect(mocks.agentStop).toHaveBeenCalled();
    expect(mocks.speechStop).toHaveBeenCalled();
    request.onText('late text');
    resolve({ candidates: [{ finishReason: 'STOP' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.events.filter((e) => e.type === 'delta')).toHaveLength(0);
    expect(mocks.events.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', id: 'request', text: 'Stopped.', cancelled: true },
    ]);
  });
  it('recovers after missing-key errors and streams a subsequent request', async () => {
    await invoke('submit', req('hello'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.events.some((e) => e.type === 'error')).toBe(true);
    mocks.settings.vlmApiKey = 'test';
    mocks.generate.mockImplementation(async (r) => {
      r.onText('Hello!');
      return { candidates: [{ finishReason: 'STOP' }] };
    });
    await invoke('submit', req('hello again', 'next'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.events.some((e) => e.type === 'done' && e.id === 'next')).toBe(
      true,
    );
  });
  it('rejects calls from other renderer frames', () => {
    expect(() =>
      mocks.handlers.get('assistant:cancel')!({
        sender: owner,
        senderFrame: { url: 'file:///other' },
      }),
    ).toThrow('Untrusted');
  });
});
