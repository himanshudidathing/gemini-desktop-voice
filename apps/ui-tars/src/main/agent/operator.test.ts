import { beforeEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({
  move: vi.fn(async () => {}),
  click: vi.fn(async () => {}),
  press: vi.fn(async () => {}),
  release: vi.fn(async () => {}),
  capture: vi.fn(),
}));
vi.mock('@computer-use/nut-js', () => ({
  Key: {
    LeftControl: 1,
    V: 2,
    Enter: 3,
    LeftCmd: 4,
    LeftWin: 5,
    LeftAlt: 6,
    LeftShift: 7,
    Up: 8,
    Down: 9,
    Left: 10,
    Right: 11,
  },
  keyboard: { pressKey: m.press, releaseKey: m.release },
  mouse: {
    setPosition: m.move,
    click: m.click,
    releaseButton: vi.fn(async () => {}),
  },
  Button: { LEFT: 1 },
  Point: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  straightTo: vi.fn(),
}));
vi.mock('electron', () => ({
  clipboard: { readText: () => '', writeText: vi.fn() },
  desktopCapturer: { getSources: m.capture },
}));
vi.mock('../utils/screen', () => ({
  getScreenSize: () => ({
    physicalSize: { width: 1920, height: 1080 },
    logicalSize: { width: 1920, height: 1080 },
    scaleFactor: 1,
    id: 1,
  }),
}));
import { NutJSElectronOperator } from './operator';
const params = (action = 'click') =>
  ({
    parsedPrediction: {
      action_type: action,
      action_inputs: { start_box: '[0.5,0.5,0.5,0.5]', key: 'ctrl v' },
      thought: '',
      reflection: null,
    },
    prediction: '',
    screenWidth: 1920,
    screenHeight: 1080,
    scaleFactor: 1,
    factors: [1000, 1000],
  }) as any;
beforeEach(() => vi.clearAllMocks());
describe('cancellable desktop operator', () => {
  it('skips click when cancelled during pointer movement', async () => {
    const c = new AbortController();
    m.move.mockImplementationOnce(async () => {
      c.abort();
    });
    await expect(
      new NutJSElectronOperator(c.signal).execute(params()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.click).not.toHaveBeenCalled();
  });
  it('releases hotkeys if cancellation arrives after key down', async () => {
    const c = new AbortController();
    m.press.mockImplementationOnce(async () => {
      c.abort();
    });
    await expect(
      new NutJSElectronOperator(c.signal).execute(params('hotkey')),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.release).toHaveBeenCalled();
  });
  it('captures once at target resolution and supplies metadata without a Jimp decode', async () => {
    const image = {
      isEmpty: () => false,
      toJPEG: () => Buffer.from('image'),
      getSize: () => ({ width: 1920, height: 1080 }),
    };
    m.capture.mockResolvedValue([{ display_id: '1', thumbnail: image }]);
    const result = await new NutJSElectronOperator().screenshot();
    expect(m.capture).toHaveBeenCalledOnce();
    expect(result.size).toEqual({ width: 1920, height: 1080 });
    expect(result.mime).toBe('image/jpeg');
  });
  it('rejects invalid coordinates before mouse I/O', async () => {
    const p = params();
    p.parsedPrediction.action_inputs.start_box = '[-1,0,-1,0]';
    await expect(new NutJSElectronOperator().execute(p)).rejects.toThrow(
      'invalid',
    );
    expect(m.move).not.toHaveBeenCalled();
  });
});
