import { transcribeAudio } from './audioTranscription';
import {
  app,
  ipcMain,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
  type WebContents,
} from 'electron';
import { SettingStore } from '../store/setting';
import { GeminiLiveSession } from './geminiLive';
import { DEFAULT_ASSISTANT_NAME, DEFAULT_LIVE_MODEL } from '../shared/voice';
import * as env from '../env';

function trusted(event: IpcMainInvokeEvent | IpcMainEvent) {
  const url = event.senderFrame?.url ?? '';
  if (
    event.senderFrame !== event.sender.mainFrame ||
    !(
      url.startsWith('file:') ||
      (!!env.rendererUrl && url.startsWith(env.rendererUrl))
    )
  )
    throw new Error('Voice is available only in the desktop application.');
}

export function registerVoiceHandlers() {
  let owner: WebContents | null = null;
  let session: GeminiLiveSession | null = null;
  let releaseOwner: (() => void) | null = null;
  const disconnect = () => {
    releaseOwner?.();
    releaseOwner = null;
    session?.stop();
    session = null;
    owner = null;
  };
  ipcMain.handle('voice:start', async (event) => {
    trusted(event);
    if (owner && owner.id !== event.sender.id)
      throw new Error('Voice is already active in another window.');
    disconnect();
    owner = event.sender;
    const source = event.sender;
    const settings = SettingStore.getStore();
    session = new GeminiLiveSession((message) => {
      if (!source.isDestroyed()) source.send('voice:event', message);
    });
    const onDestroyed = () => {
      if (owner === source) disconnect();
    };
    source.once('destroyed', onDestroyed);
    source.once('render-process-gone', onDestroyed);
    releaseOwner = () => {
      source.removeListener('destroyed', onDestroyed);
      source.removeListener('render-process-gone', onDestroyed);
    };
    try {
      await session.start({
        apiKey: settings.vlmApiKey,
        model: settings.liveModelName || DEFAULT_LIVE_MODEL,
        assistantName: settings.assistantName || DEFAULT_ASSISTANT_NAME,
        voiceName: settings.voiceName || 'Aoede',
      });
    } catch (error) {
      if (owner === source) disconnect();
      throw error;
    }
  });
  ipcMain.handle('voice:stop', (event) => {
    trusted(event);
    if (owner?.id === event.sender.id) disconnect();
  });
  ipcMain.on('voice:audio', (event, bytes: unknown) => {
    try {
      trusted(event);
    } catch {
      return;
    }
    if (owner?.id === event.sender.id && bytes instanceof Uint8Array)
      session?.audio(bytes);
  });
  ipcMain.handle(
    'voice:result',
    (event, value: { id: string; text: string }) => {
      trusted(event);
      if (
        owner?.id === event.sender.id &&
        typeof value?.id === 'string' &&
        typeof value?.text === 'string'
      )
        session?.result(value.id, value.text);
    },
  );
  ipcMain.handle(
    'voice:transcribe',
    async (event, audio: { bytes: Uint8Array; mimeType: string }) => {
      trusted(event);
      return transcribeAudio(audio, SettingStore.getStore());
    },
  );
  ipcMain.handle('voice:speak', (event, text: string) => {
    trusted(event);
    if (owner?.id === event.sender.id && typeof text === 'string')
      session?.speak(text);
  });
  app.on('before-quit', disconnect);
}
