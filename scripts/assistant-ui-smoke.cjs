const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const { chromium } = require('@playwright/test');
const root = path.resolve('apps/ui-tars/dist/renderer');
const out = path.resolve(
  process.env.ASSISTANT_SMOKE_OUTPUT_DIR || 'test-results/assistant',
);
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    ),
    file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : undefined),
    headless: true,
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 460, height: 900 },
      }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const settings = {
        vlmApiKey: 'test',
        assistantName: 'Gemini',
        operator: 'Local Computer Operator',
      };
      const listeners = new Set();
      let active,
        voice = false,
        record = 0;
      const emit = (e) => listeners.forEach((f) => f(e));
      window.__stats = {
        models: 0,
        local: 0,
        cancel: 0,
        recordBytes: 0,
        finished: 0,
        windows: [],
      };
      const picture =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#192631';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#99dfcb';
        ctx.font = '30px sans-serif';
        ctx.fillText('Local recording test', 40, 100);
        const stream = canvas.captureStream(10);
        window.__recordTracks = stream.getTracks();
        return stream;
      };
      window.electron = {
        setting: {
          getSetting: async () => ({ ...settings }),
          updateSetting: async (value) => Object.assign(settings, value),
        },
        assistant: {
          onEvent: (callback) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
          submit: async (r) => {
            const t = r.text.toLowerCase();
            const map = {
              'can you hear me?': 'health',
              'take screenshot': 'screenshot',
              'clear conversation': 'clear',
              'open settings': 'settings',
              'start screen recording': 'record-start',
              'stop screen recording': 'record-stop',
              stop: 'cancel',
            };
            if (map[t]) {
              window.__stats.local++;
              if (t === 'take screenshot')
                emit({
                  type: 'artifact',
                  artifact: {
                    id: 'shot',
                    kind: 'screenshot',
                    name: 'screen.png',
                    path: 'Pictures/screen.png',
                    preview: picture,
                  },
                });
              emit({
                type: 'local',
                command: map[t],
                text:
                  t === 'can you hear me?'
                    ? 'Yes, I can hear you. I am listening locally.'
                    : t === 'take screenshot'
                      ? 'Screenshot saved locally.'
                      : t === 'clear conversation'
                        ? 'Conversation cleared.'
                        : 'Done.',
              });
              return { local: true };
            }
            window.__stats.models++;
            active = r.id;
            const model =
              r.mode === 'screen' ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it';
            emit({
              type: 'status',
              id: r.id,
              text: 'Local capability routing',
              model,
            });
            if (t === 'long request') {
              setTimeout(
                () =>
                  active === r.id &&
                  emit({
                    type: 'delta',
                    id: r.id,
                    text: 'A partial response before cancellation.',
                  }),
                30,
              );
            } else {
              setTimeout(() => {
                if (active === r.id) {
                  emit({
                    type: 'delta',
                    id: r.id,
                    text: 'A faster, more responsive assistant.',
                  });
                  emit({
                    type: 'done',
                    id: r.id,
                    text: 'A faster, more responsive assistant.',
                  });
                  active = undefined;
                }
              }, 100);
            }
            return { local: false };
          },
          cancel: async () => {
            window.__stats.cancel++;
            if (active)
              emit({
                type: 'done',
                id: active,
                text: 'Stopped.',
                cancelled: true,
              });
            active = undefined;
            emit({ type: 'record-stop' });
          },
          toggleVoice: async () => {
            voice = !voice;
            emit({ type: 'voice', state: voice ? 'listening' : 'off' });
          },
          window: async (action) => window.__stats.windows.push(action),
          startRecording: async () => String(++record),
          appendRecording: async (id, bytes) => {
            window.__stats.recordBytes += bytes.length;
          },
          finishRecording: async (id) => {
            window.__stats.finished++;
            emit({
              type: 'artifact',
              artifact: {
                id: 'rec-' + id,
                kind: 'recording',
                name: 'record.webm',
                path: 'Videos/record.webm',
                durationMs: 1000,
              },
            });
          },
          reveal: async () => {},
          transcribe: async () => 'Transcribed audio ready for review.',
          quotas: async () => [],
        },
      };
    });
    const waitFor = async (predicate) => {
      for (let i = 0; i < 80; i++) {
        if (await page.evaluate(predicate)) return;
        await page.waitForTimeout(100);
      }
      throw new Error('UI condition timed out');
    };
    const start = Date.now();
    await page.goto(
      process.env.ASSISTANT_TEST_URL ||
        'http://127.0.0.1:' + server.address().port,
    );
    await page
      .getByRole('heading', { name: 'A little less effort. A lot more done.' })
      .waitFor();
    const startupMs = Date.now() - start;
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'assistant-sidebar.png') });
    const send = async (text) => {
      await page.getByRole('textbox', { name: 'Message assistant' }).fill(text);
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
    };
    await send('Can you hear me?');
    await page
      .getByText('Yes, I can hear you. I am listening locally.', {
        exact: true,
      })
      .waitFor();
    if ((await page.evaluate(() => window.__stats.models)) !== 0)
      throw new Error('Health check invoked a model');
    await page
      .getByRole('button', { name: 'Take screenshot', exact: true })
      .click();
    await page.getByRole('img', { name: 'Latest screenshot' }).waitFor();
    if ((await page.evaluate(() => window.__stats.models)) !== 0)
      throw new Error('Screenshot invoked a model');
    await send('hello');
    await page
      .getByText('A faster, more responsive assistant.', { exact: true })
      .waitFor();
    await send('long request');
    await page
      .getByText('A partial response before cancellation.', { exact: true })
      .waitFor();
    await page.keyboard.press('Escape');
    await page.getByText('Stopped', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Enable microphone' }).click();
    await page.getByText('Listening locally', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Disable microphone' }).click();
    await page
      .getByRole('button', { name: 'Start screen recording', exact: true })
      .click();
    await page.getByText('Recording screen', { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    await page
      .getByRole('button', { name: 'Stop screen recording', exact: true })
      .click();
    await waitFor(
      () =>
        window.__stats.finished > 0 &&
        window.__recordTracks.every((t) => t.readyState === 'ended'),
    );
    if ((await page.evaluate(() => window.__stats.recordBytes)) === 0)
      throw new Error('Recording did not persist chunks');
    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .click();
    await page.getByRole('textbox', { name: 'Assistant name' }).fill('Nova');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'assistant-settings.png') });
    await page.getByRole('button', { name: /Captures/ }).click();
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await page.getByText('Screenshot attached', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await page.getByText('Gemma 31B', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Minimize sidebar', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Expand sidebar', exact: true })
      .click();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.screenshot({ path: path.join(out, 'assistant-narrow.png') });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw new Error('Horizontal overflow at 360px');
    await page.setViewportSize({ width: 820, height: 900 });
    await page.screenshot({ path: path.join(out, 'assistant-expanded.png') });
    await page.locator('input[type=file]').setInputFiles({
      name: 'task.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('audio'),
    });
    await waitFor(
      () =>
        document.querySelector('textarea').value ===
        'Transcribed audio ready for review.',
    );
    if (errors.length) throw new Error(errors.join('\\n'));
    const stats = await page.evaluate(() => window.__stats);
    fs.writeFileSync(
      path.join(out, 'ui-checks.json'),
      JSON.stringify(
        {
          startupMs,
          mockBackend: true,
          localCommands: true,
          streaming: true,
          cancellation: true,
          recordingChunkPersistence: true,
          tracksReleased: true,
          audioReview: true,
          responsiveWidths: [360, 460, 820],
          rendererErrors: errors.length,
          stats,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ startupMs, rendererErrors: errors.length, stats }),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
