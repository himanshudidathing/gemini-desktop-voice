/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserWindow, screen } from 'electron';

import { logger } from '@main/logger';
import * as env from '@main/env';

import { createWindow } from './createWindow';

let mainWindow: BrowserWindow | null = null;

export function showInactive() {
  if (mainWindow) {
    // eslint-disable-next-line no-unused-expressions
    mainWindow.showInactive();
  }
}

export function show() {
  if (mainWindow) {
    mainWindow.show();
  }
}

export function createMainWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(460, area.width);
  mainWindow = createWindow({
    routerPath: '/',
    showInBackground: process.env.GEMINI_START_HIDDEN === '1',
    width,
    height: area.height,
    x: area.x + area.width - width,
    y: area.y,
    minWidth: Math.min(360, area.width),
    minHeight: Math.min(480, area.height),
    frame: false,
    transparent: false,
    backgroundColor: '#111318',
    vibrancy: undefined,
    alwaysOnTop: true,
    title: 'Gemini Desktop',
  });
  mainWindow.setMenuBarVisibility(false);
  // Re-dock after monitor/work-area changes; never leave the controls off screen.
  const dock = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const work = screen.getDisplayMatching(bounds).workArea;
    const nextWidth = Math.min(bounds.width, work.width);
    mainWindow.setBounds({
      x: work.x + work.width - nextWidth,
      y: work.y,
      width: nextWidth,
      height: work.height,
    });
  };
  screen.on('display-metrics-changed', dock);
  screen.on('display-removed', dock);
  mainWindow.once('closed', () => {
    screen.removeListener('display-metrics-changed', dock);
    screen.removeListener('display-removed', dock);
  });

  mainWindow.on('close', (event) => {
    logger.info('mainWindow closed');
    if (env.isMacOS) {
      event.preventDefault();

      // Black screen on window close in fullscreen mode
      // https://github.com/electron/electron/issues/20263#issuecomment-633179965
      if (mainWindow?.isFullScreen()) {
        mainWindow?.setFullScreen(false);

        mainWindow?.once('leave-full-screen', () => {
          mainWindow?.hide();
        });
      } else {
        mainWindow?.hide();
      }
    } else {
      mainWindow = null;
    }
  });

  return mainWindow;
}

export function setContentProtection(enable: boolean) {
  mainWindow?.setContentProtection(enable);
}

export async function showWindow() {
  mainWindow?.setContentProtection(false);
  mainWindow?.setIgnoreMouseEvents(false);
  mainWindow?.show();
  mainWindow?.restore();
}

export async function hideMainWindow() {
  try {
    mainWindow?.setContentProtection(true);
    mainWindow?.setAlwaysOnTop(true);
    mainWindow?.setFocusable(false);
    mainWindow?.hide();
  } catch (error) {
    logger.error('[hideMainWindow]', error);
  }
}

export async function showMainWindow() {
  try {
    mainWindow?.setContentProtection(false);
    setTimeout(() => {
      mainWindow?.setAlwaysOnTop(false);
    }, 100);
    mainWindow?.setFocusable(true);
    mainWindow?.show();
  } catch (error) {
    logger.error('[showMainWindow]', error);
  }
}
