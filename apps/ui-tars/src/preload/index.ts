/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';
// import { preloadZustandBridge } from 'zutron/preload';

import type { UTIOPayload } from '@ui-tars/utio';

import type { VoiceEvent } from '@main/shared/voice';
import type {
  AssistantEvent,
  AssistantRequest,
  MediaArtifact,
} from '@main/shared/assistant';
import type { AppState, LocalStore } from '@main/store/types';

export type Channels = '';

const electronHandler = {
  assistant: {
    submit: (request: AssistantRequest): Promise<{ local: boolean }> =>
      ipcRenderer.invoke('assistant:submit', request),
    cancel: (): Promise<void> => ipcRenderer.invoke('assistant:cancel'),
    toggleVoice: (): Promise<void> => ipcRenderer.invoke('assistant:voice'),
    startVoice: (): Promise<void> =>
      ipcRenderer.invoke('assistant:voice-start'),
    stopVoice: (): Promise<void> => ipcRenderer.invoke('assistant:voice-stop'),
    bargeIn: (): Promise<void> => ipcRenderer.invoke('assistant:voice-barge'),
    voiceAudio: (bytes: Uint8Array): void =>
      ipcRenderer.send('assistant:voice-audio', bytes),
    window: (action: 'minimize' | 'expand' | 'close'): Promise<void> =>
      ipcRenderer.invoke('assistant:window', action),
    startRecording: (): Promise<string> =>
      ipcRenderer.invoke('assistant:record-start'),
    appendRecording: (id: string, bytes: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('assistant:record-chunk', id, bytes),
    finishRecording: (id: string): Promise<MediaArtifact | null> =>
      ipcRenderer.invoke('assistant:record-finish', id),
    reveal: (id: string): Promise<void> =>
      ipcRenderer.invoke('assistant:reveal', id),
    transcribe: (bytes: Uint8Array, mimeType: string): Promise<string> =>
      ipcRenderer.invoke('assistant:transcribe', bytes, mimeType),
    quotas: (): Promise<
      {
        model: string;
        requests: number;
        tokens: number;
        queued: number;
        waitMs: number;
      }[]
    > => ipcRenderer.invoke('assistant:quotas'),
    onEvent: (callback: (event: AssistantEvent) => void) => {
      const listener = (_: IpcRendererEvent, value: AssistantEvent) =>
        callback(value);
      ipcRenderer.on('assistant:event', listener);
      return () => ipcRenderer.removeListener('assistant:event', listener);
    },
  },
  voice: {
    speak: (text: string): Promise<void> =>
      ipcRenderer.invoke('voice:speak', text),
    start: (): Promise<void> => ipcRenderer.invoke('voice:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('voice:stop'),
    audio: (bytes: Uint8Array) => ipcRenderer.send('voice:audio', bytes),
    result: (id: string, text: string): Promise<void> =>
      ipcRenderer.invoke('voice:result', { id, text }),
    transcribe: (bytes: Uint8Array, mimeType: string): Promise<string> =>
      ipcRenderer.invoke('voice:transcribe', { bytes, mimeType }),
    onEvent: (callback: (event: VoiceEvent) => void) => {
      const listener = (_event: IpcRendererEvent, value: VoiceEvent) =>
        callback(value);
      ipcRenderer.on('voice:event', listener);
      return () => {
        ipcRenderer.removeListener('voice:event', listener);
      };
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(channel, ...args),
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  utio: {
    shareReport: (params: UTIOPayload<'shareReport'>) =>
      ipcRenderer.invoke('utio:shareReport', params),
  },
  setting: {
    getSetting: () => ipcRenderer.invoke('setting:get'),
    clearSetting: () => ipcRenderer.invoke('setting:clear'),
    updateSetting: (setting: Partial<LocalStore>) =>
      ipcRenderer.invoke('setting:update', setting),
    importPresetFromText: (yamlContent: string) =>
      ipcRenderer.invoke('setting:importPresetFromText', yamlContent),
    importPresetFromUrl: (url: string, autoUpdate: boolean) =>
      ipcRenderer.invoke('setting:importPresetFromUrl', url, autoUpdate),
    updatePresetFromRemote: () =>
      ipcRenderer.invoke('setting:updatePresetFromRemote'),
    resetPreset: () => ipcRenderer.invoke('setting:resetPreset'),
    onUpdate: (callback: (setting: LocalStore) => void) => {
      ipcRenderer.on('setting-updated', (_, state) => callback(state));
    },
  },
};

// Initialize zustand bridge
const zustandBridge = {
  getState: () => ipcRenderer.invoke('getState'),
  subscribe: (callback) => {
    const subscription = (_: unknown, state: AppState) => callback(state);
    ipcRenderer.on('subscribe', subscription);

    return () => ipcRenderer.off('subscribe', subscription);
  },
};

// Expose both electron and zutron handlers
contextBridge.exposeInMainWorld('electron', electronHandler);
contextBridge.exposeInMainWorld('zustandBridge', zustandBridge);
contextBridge.exposeInMainWorld('platform', process.platform);

export type ElectronHandler = typeof electronHandler;
