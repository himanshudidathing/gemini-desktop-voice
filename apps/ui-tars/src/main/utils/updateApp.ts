import type { UpdateInfo } from 'builder-util-runtime';
import { app, dialog, type BrowserWindow } from 'electron';

/** A fork must never install the upstream multi-provider application over itself. */
export class AppUpdater {
  constructor(_mainWindow: BrowserWindow) {}
  async checkForUpdatesDetail(): Promise<{
    currentVersion: string;
    updateInfo: UpdateInfo | null;
    updaterDisabled: boolean;
  }> {
    return {
      currentVersion: app.getVersion(),
      updateInfo: null,
      updaterDisabled: true,
    };
  }
  checkForUpdates() {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Gemini Desktop updates',
      message:
        'Automatic upstream updates are disabled for this Gemini-only build.',
      detail: 'Install new releases from your Gemini Desktop fork.',
    });
  }
}
