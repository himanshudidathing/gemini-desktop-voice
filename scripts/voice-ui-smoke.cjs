const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireRepo = createRequire(path.resolve('package.json'));
const { chromium } = requireRepo('@playwright/test');
const rendererRoot = path.resolve('apps/ui-tars/dist/renderer');
const outputs = path.resolve(
  process.env.VOICE_SMOKE_OUTPUT_DIR || 'test-results/voice-ui',
);
fs.mkdirSync(outputs, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(
    new URL(request.url, 'http://localhost').pathname,
  );
  const file = path.resolve(
    rendererRoot,
    '.' + (name === '/' ? '/index.html' : name),
  );
  if (!file.startsWith(rendererRoot + path.sep) || !fs.existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader(
    'Content-Type',
    mime[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(response);
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : undefined),
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const settings = {
        vlmProvider: 'Google Gemini',
        vlmBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        vlmApiKey: 'test-key',
        vlmModelName: 'gemini-3.8-flash',
        liveModelName: 'gemini-3.8-live',
        assistantName: 'Gemini',
        voiceName: 'Aoede',
        operator: 'Local Computer Operator',
        language: 'en',
        useResponsesApi: false,
        maxLoopCount: 100,
        loopIntervalInMs: 1000,
      };
      const state = {
        theme: 'light',
        status: 'init',
        messages: [],
        sessionHistoryMessages: [],
        instructions: '',
        restUserData: null,
        thinking: false,
        errorMsg: null,
        ensurePermissions: { screenCapture: true, accessibility: true },
        browserAvailable: true,
      };
      const listeners = new Set();
      const settingListeners = new Set();
      const voiceListeners = new Set();
      const emit = () =>
        listeners.forEach((callback) => callback({ ...state }));
      window.__frames = 0;
      window.__tasks = 0;
      window.__results = [];
      window.__stops = 0;
      window.__voiceEvent = (event) =>
        voiceListeners.forEach((callback) => callback(event));
      window.platform = 'win32';
      window.zustandBridge = {
        getState: async () => ({ ...state }),
        subscribe: (callback) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      };
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await getUserMedia(...args);
        window.__lastStream = stream;
        return stream;
      };
      window.electron = {
        setting: {
          getSetting: async () => ({ ...settings }),
          onUpdate: (callback) => settingListeners.add(callback),
          updateSetting: async (value) => {
            Object.assign(settings, value);
            settingListeners.forEach((callback) => callback({ ...settings }));
          },
          clearSetting: async () => {},
          resetPreset: async () => {},
        },
        voice: {
          start: async () => {
            window.__voiceEvent({ type: 'state', state: 'listening' });
          },
          stop: async () => {
            window.__voiceEvent({ type: 'state', state: 'off' });
          },
          audio: (bytes) => {
            window.__frames++;
            if (bytes.byteLength !== 3200)
              throw new Error('Unexpected microphone chunk');
          },
          onEvent: (callback) => {
            voiceListeners.add(callback);
            return () => voiceListeners.delete(callback);
          },
          result: async (id, text) => {
            window.__results.push({ id, text });
          },
          speak: async (text) => {
            window.__results.push({ text });
          },
          transcribe: async () => 'Find the weather in Delhi',
        },
        ipcRenderer: {
          on: () => () => {},
          once: () => {},
          sendMessage: () => {},
          invoke: async (method, input) => {
            if (method === 'clearHistory') {
              Object.assign(state, {
                messages: [],
                status: 'end',
                thinking: false,
              });
              emit();
            }
            if (method === 'setInstructions')
              state.instructions = input.instructions;
            if (method === 'setMessages') state.messages = input.messages;
            if (method === 'setSessionHistoryMessages')
              state.sessionHistoryMessages = input.messages;
            if (method === 'runAgent') {
              window.__tasks++;
              state.status = 'running';
              state.thinking = true;
              emit();
              await new Promise((resolve) => setTimeout(resolve, 30));
              state.messages = [
                ...state.messages,
                {
                  from: 'gpt',
                  value: 'Done',
                  predictionParsed: [
                    {
                      action_type: 'finished',
                      action_inputs: {
                        content: 'The requested task is complete.',
                      },
                      thought: 'Done',
                    },
                  ],
                  timing: { start: Date.now(), end: Date.now(), cost: 0 },
                },
              ];
              state.status = 'end';
              state.thinking = false;
              emit();
            }
            if (method === 'stopRun') {
              window.__stops++;
              state.status = 'end';
              state.thinking = false;
              emit();
            }
            if (method === 'checkModelAvailability') return true;
            if (method === 'checkForUpdatesDetail')
              return {
                currentVersion: '0.2.4',
                updateInfo: null,
                isPackaged: false,
                updaterDisabled: true,
              };
            return undefined;
          },
        },
      };
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page
      .getByRole('heading', { name: 'Say it. Gemini gets to work.' })
      .waitFor();
    await page.screenshot({
      path: path.join(outputs, 'gemini-voice-home.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Open your computer' }).click();
    await page
      .getByRole('button', { name: 'Enable voice', exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: 'Enable voice', exact: true })
      .click();
    await page
      .getByText('Microphone on · awaiting name', { exact: true })
      .waitFor();
    await page.waitForFunction(() => window.__frames > 1);
    await page.evaluate(() =>
      window.__voiceEvent({
        type: 'command',
        id: 'test-command',
        text: 'Open Chrome',
        stop: false,
      }),
    );
    await page.waitForFunction(
      () =>
        window.__tasks === 1 &&
        window.__results.some(
          (result) =>
            result.id === 'test-command' && result.text.includes('complete'),
        ),
    );
    await page.evaluate(() =>
      window.__voiceEvent({
        type: 'command',
        id: 'stop-command',
        text: 'stop',
        stop: true,
      }),
    );
    await page.waitForFunction(
      () =>
        window.__stops > 0 &&
        window.__results.some((result) => result.id === 'stop-command'),
    );
    await page
      .getByRole('button', { name: 'Turn voice off', exact: true })
      .click();
    await page.waitForFunction(() =>
      window.__lastStream
        .getTracks()
        .every((track) => track.readyState === 'ended'),
    );
    await page
      .locator('input[type=file]')
      .setInputFiles({
        name: 'task.wav',
        mimeType: 'audio/wav',
        buffer: Buffer.from('test audio'),
      });
    await page.locator('textarea').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('textarea')?.value ===
        'Find the weather in Delhi',
    );
    await page
      .getByRole('button', { name: 'Enable voice', exact: true })
      .click();
    await page
      .getByText('Microphone on · awaiting name', { exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.__voiceEvent({
        type: 'transcript',
        speaker: 'user',
        text: 'Gemini, open Chrome',
      });
      window.__voiceEvent({
        type: 'transcript',
        speaker: 'assistant',
        text: 'The requested task is complete.',
      });
    });
    await page.evaluate(() =>
      window.__voiceEvent({
        type: 'audio',
        data: btoa(String.fromCharCode(0).repeat(48000)),
        sampleRate: 24000,
      }),
    );
    await page
      .getByText('Speaking · microphone paused', { exact: true })
      .waitFor();
    await page
      .getByText('Microphone on · awaiting name', { exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(outputs, 'gemini-voice-session.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Turn voice off', exact: true })
      .click();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      JSON.stringify({
        homeRendered: true,
        microphonePCM: true,
        voiceTaskDispatch: true,
        spokenResultRouting: true,
        microphoneReleased: true,
        audioUploadToComposer: true,
        rendererErrors: errors.length,
      }),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
