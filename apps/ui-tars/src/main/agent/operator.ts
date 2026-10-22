/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Key,
  keyboard,
  mouse,
  Button,
  Point,
  straightTo,
} from '@computer-use/nut-js';
import {
  Operator,
  StatusEnum,
  parseBoxToScreenCoords,
  type ScreenshotOutput,
  type ExecuteParams,
  type ExecuteOutput,
} from '@ui-tars/sdk/core';
import { clipboard, desktopCapturer } from 'electron';
import { getScreenSize } from '../utils/screen';
import { abortable } from '../services/operations';

export class NutJSElectronOperator extends Operator {
  static MANUAL = {
    ACTION_SPACES: [
      'click()',
      'left_double()',
      'right_single()',
      'drag()',
      'hotkey()',
      'type()',
      'scroll()',
      'wait()',
      'finished()',
      'call_user()',
    ],
  };
  constructor(private readonly signal?: AbortSignal) {
    super();
  }
  public async screenshot(): Promise<ScreenshotOutput> {
    this.signal?.throwIfAborted();
    const { physicalSize, scaleFactor, id } = getScreenSize();
    const pending = desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: physicalSize,
      fetchWindowIcons: false,
    });
    const sources = this.signal
      ? await abortable(pending, this.signal)
      : await pending;
    this.signal?.throwIfAborted();
    const image = (
      sources.find((s) => s.display_id === String(id)) || sources[0]
    )?.thumbnail;
    if (!image || image.isEmpty())
      throw new Error(
        'Screen capture unavailable. Check screen-recording permissions.',
      );
    return {
      base64: image.toJPEG(70).toString('base64'),
      scaleFactor,
      size: image.getSize(),
      mime: 'image/jpeg',
    };
  }
  async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { action_type: action, action_inputs: inputs } =
      params.parsedPrediction;
    if (['user_stop', 'finished', 'call_user'].includes(action))
      return { status: StatusEnum.END };
    const signal = this.signal;
    const check = () => signal?.throwIfAborted();
    check();
    const held: Key[] = [];
    let dragging = false;
    const release = () => {
      if (held.length) void keyboard.releaseKey(...held).catch(() => {});
      if (dragging) void mouse.releaseButton(Button.LEFT).catch(() => {});
    };
    signal?.addEventListener('abort', release, { once: true });
    const position = (box: string) => {
      const { x, y } = parseBoxToScreenCoords({
        boxStr: box,
        screenWidth: params.screenWidth,
        screenHeight: params.screenHeight,
      });
      if (
        x === null ||
        y === null ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x >= params.screenWidth ||
        y >= params.screenHeight
      )
        throw new Error('The model returned an invalid screen coordinate.');
      return new Point(x, y);
    };
    const move = async () => {
      check();
      await mouse.setPosition(position(inputs.start_box || ''));
      check();
    };
    const press = async (keys: Key[]) => {
      check();
      held.push(...keys);
      try {
        await keyboard.pressKey(...keys);
        check();
      } finally {
        await keyboard.releaseKey(...keys);
        held.length = 0;
      }
    };
    try {
      switch (action) {
        case 'wait':
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              signal?.removeEventListener('abort', abort);
              reject(signal?.reason);
            };
            const timer = setTimeout(() => {
              signal?.removeEventListener('abort', abort);
              resolve();
            }, 1000);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
          });
          break;
        case 'click':
        case 'left_click':
        case 'left_single':
          await move();
          check();
          await mouse.click(Button.LEFT);
          break;
        case 'left_double':
        case 'double_click':
          await move();
          check();
          await mouse.doubleClick(Button.LEFT);
          break;
        case 'right_single':
        case 'right_click':
          await move();
          check();
          await mouse.click(Button.RIGHT);
          break;
        case 'hover':
        case 'mouse_move':
          await move();
          break;
        case 'drag': {
          const end = position(inputs.end_box || '');
          await move();
          check();
          dragging = true;
          try {
            await mouse.pressButton(Button.LEFT);
            check();
            await mouse.move(straightTo(end));
            check();
          } finally {
            await mouse.releaseButton(Button.LEFT);
            dragging = false;
          }
          break;
        }
        case 'type': {
          const content = inputs.content || '',
            original = clipboard.readText();
          if (!content || content.length > 10000)
            throw new Error('Invalid typing action.');
          const text = content.replace(/\\n$/, '').replace(/\n$/, '');
          try {
            check();
            clipboard.writeText(text);
            await press([
              process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl,
              Key.V,
            ]);
            // Allow the target application to consume the clipboard before restoring it.
            await new Promise((resolve) => setTimeout(resolve, 50));
            check();
            if (content.endsWith('\n') || content.endsWith('\\n'))
              await press([Key.Enter]);
          } finally {
            clipboard.writeText(original);
          }
          break;
        }
        case 'hotkey': {
          const aliases: Record<string, Key> = {
            ctrl: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl,
            cmd: Key.LeftCmd,
            command: Key.LeftCmd,
            win: Key.LeftWin,
            meta: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftWin,
            alt: Key.LeftAlt,
            shift: Key.LeftShift,
            return: Key.Enter,
            arrowup: Key.Up,
            arrowdown: Key.Down,
            arrowleft: Key.Left,
            arrowright: Key.Right,
          };
          const names = (inputs.key || inputs.hotkey || '')
            .toLowerCase()
            .split(/[+\s]+/)
            .filter(Boolean);
          const all = Object.fromEntries(
            Object.entries(Key).map(([k, v]) => [k.toLowerCase(), v]),
          );
          const keys = names.map((name) => aliases[name] ?? all[name]) as Key[];
          if (
            !keys.length ||
            keys.length > 6 ||
            keys.some((k) => typeof k !== 'number')
          )
            throw new Error('The model returned an unsupported hotkey.');
          await press(keys);
          break;
        }
        case 'scroll':
          if (inputs.start_box) await move();
          check();
          switch (inputs.direction?.toLowerCase()) {
            case 'up':
              await mouse.scrollUp(500);
              break;
            case 'down':
              await mouse.scrollDown(500);
              break;
            case 'left':
              await mouse.scrollLeft(500);
              break;
            case 'right':
              await mouse.scrollRight(500);
              break;
            default:
              throw new Error('Unsupported scroll direction.');
          }
          break;
        default:
          throw new Error('Unsupported desktop action: ' + action);
      }
      check();
      return { status: StatusEnum.RUNNING };
    } finally {
      signal?.removeEventListener('abort', release);
      if (held.length) await keyboard.releaseKey(...held).catch(() => {});
      if (dragging) await mouse.releaseButton(Button.LEFT).catch(() => {});
    }
  }
}
