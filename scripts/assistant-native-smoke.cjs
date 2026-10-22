const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const env = { ...process.env, GEMINI_START_HIDDEN: '1', GEMINI_API_KEY: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  const start = Date.now();
  const app = await electron.launch({
    args: [path.resolve('apps/ui-tars/dist/main/main.js')],
    env,
    timeout: 45000,
  });
  const errors = [];
  app.process().stderr.on('data', (data) => {
    const text = data.toString();
    if (text.includes('Error:')) errors.push(text.slice(0, 500));
  });
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .waitFor();
    const readyMs = Date.now() - start;
    const mainFolder = path.resolve('apps/ui-tars/dist/main');
    const operatorFile = fs
      .readdirSync(mainFolder)
      .find((file) => /^operator-[^/]+\.js$/.test(file));
    if (!operatorFile) throw new Error('Native operator bundle is missing.');
    const nativeOperatorLoaded = await app.evaluate(
      (_, file) => {
        process.getBuiltinModule('module').createRequire(file)(file);
        return true;
      },
      path.join(mainFolder, operatorFile),
    );
    const before = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        area: screen.getDisplayMatching(w.getBounds()).workArea,
        bounds: w.getBounds(),
        visible: w.isVisible(),
        alwaysOnTop: w.isAlwaysOnTop(),
      };
    });
    await page.evaluate(() =>
      window.electron.assistant.submit({
        id: 'native-local-health',
        text: 'Can you hear me?',
        mode: 'auto',
      }),
    );
    await page
      .getByText('I am here. Turn on the microphone to use voice.', {
        exact: true,
      })
      .waitFor();
    await page.evaluate(() => window.electron.assistant.window('expand'));
    const expanded = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    await page.evaluate(() => window.electron.assistant.window('expand'));
    const restored = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    assert.equal(before.visible, false, 'Hidden startup must stay hidden');
    assert.equal(before.alwaysOnTop, true, 'Assistant must stay on top');
    assert.equal(before.bounds.width, Math.min(460, before.area.width));
    assert.equal(expanded.width, Math.min(820, before.area.width));
    assert.deepEqual(
      restored,
      before.bounds,
      'Restore must preserve dock bounds',
    );
    for (const bounds of [before.bounds, expanded, restored]) {
      assert.equal(bounds.x + bounds.width, before.area.x + before.area.width);
      assert.equal(bounds.y, before.area.y);
      assert.equal(bounds.height, before.area.height);
    }
    await page.evaluate(() => window.electron.assistant.cancel());
    const out = path.resolve(
      process.env.ASSISTANT_SMOKE_OUTPUT_DIR || 'test-results/assistant',
    );
    fs.mkdirSync(out, { recursive: true });
    const memory = await app.evaluate(({ app }) => ({
      workingSetKB: app
        .getAppMetrics()
        .reduce((n, p) => n + p.memory.workingSetSize, 0),
    }));
    const report = {
      readyMs,
      nativeOperatorLoaded,
      memory,
      hiddenStart: !before.visible,
      before: before.bounds,
      expanded,
      restored,
      alwaysOnTop: before.alwaysOnTop,
      localHealth: true,
      cancel: true,
      errors,
    };
    fs.writeFileSync(
      path.join(out, 'native-checks.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (errors.length) throw new Error('Native runtime errors occurred.');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
