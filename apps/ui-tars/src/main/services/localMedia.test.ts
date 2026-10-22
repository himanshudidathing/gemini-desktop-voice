import { beforeEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({
  getSources: vi.fn(),
  write: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  file: { writeFile: vi.fn(async () => {}), close: vi.fn(async () => {}) },
}));
vi.mock('electron', () => ({
  app: { getPath: (type: string) => '/test/' + type },
  screen: {
    getPrimaryDisplay: () => ({
      id: 1,
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
    }),
  },
  desktopCapturer: { getSources: m.getSources },
  shell: { showItemInFolder: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  open: vi.fn(async () => m.file),
  rename: m.rename,
  unlink: m.unlink,
  writeFile: m.write,
}));
import {
  takeScreenshot,
  beginRecording,
  appendRecording,
  finishRecording,
} from './localMedia';
beforeEach(() => vi.clearAllMocks());
describe('local media lifecycle', () => {
  it('rejects an already-cancelled capture before OS I/O', async () => {
    const c = new AbortController();
    c.abort();
    await expect(takeScreenshot(c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(m.getSources).not.toHaveBeenCalled();
  });
  it('does not save or publish a screenshot that finishes after cancellation', async () => {
    let complete!: (value: any) => void;
    m.getSources.mockReturnValue(
      new Promise((resolve) => (complete = resolve)),
    );
    const c = new AbortController(),
      p = takeScreenshot(c.signal),
      assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    c.abort();
    await assertion;
    complete([]);
    await Promise.resolve();
    expect(m.write).not.toHaveBeenCalled();
  });
  it('streams recording chunks to disk and finalizes without keeping a video buffer', async () => {
    const id = await beginRecording();
    await appendRecording(id, new Uint8Array([1, 2, 3]));
    const saved = await finishRecording(id);
    expect(m.file.writeFile).toHaveBeenCalledOnce();
    expect(m.file.close).toHaveBeenCalledOnce();
    expect(m.rename).toHaveBeenCalledOnce();
    expect(saved?.kind).toBe('recording');
    await expect(appendRecording(id, new Uint8Array([1]))).rejects.toThrow(
      'stopped',
    );
  });
  it('cleans up an empty recording when capture setup is cancelled', async () => {
    const id = await beginRecording();
    expect(await finishRecording(id)).toBeNull();
    expect(m.unlink).toHaveBeenCalledOnce();
  });
});
