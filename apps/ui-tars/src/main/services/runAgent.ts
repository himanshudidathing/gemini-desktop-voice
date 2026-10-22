/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger } from '@main/logger';
import { StatusEnum } from '@ui-tars/shared/types';
import { GUIAgent } from '@ui-tars/sdk';
import { GeminiModel } from '@ui-tars/sdk/core';
import { SettingStore } from '@main/store/setting';
import { AppState, Operator } from '@main/store/types';
import { GUIAgentManager } from '../ipcRoutes/agent';
import { getModelVersion, getLocalBrowserSearchEngine } from '../utils/agent';
import {
  getLocalModelConfig,
  getGeminiSystemPrompt,
} from '../shared/modelProviders';
import { abortable } from './operations';
import { desktopText } from '../shared/assistant';

export const runAgent = async (
  setState: (state: Partial<AppState>) => void,
  getState: () => AppState,
  options?: {
    onProgress?: (text: string) => void;
    onRoute?: (model: string, reason: string) => void;
    model?: string;
    onVision?: (vision: import('@ui-tars/sdk/core').VisionResult) => void;
  },
) => {
  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  const signal = abortController?.signal;
  if (!instructions || !signal)
    throw new Error('A task and cancellation controller are required.');
  const current = () =>
    !signal.aborted && getState().abortController === abortController;
  if (
    ![Operator.LocalComputer, Operator.LocalBrowser].includes(settings.operator)
  )
    throw new Error('Choose a local computer or browser operator.');
  signal.throwIfAborted();
  options?.onProgress?.('Preparing desktop tools…');
  let operator;
  if (settings.operator === Operator.LocalBrowser) {
    const { checkBrowserAvailability } = await import('./browserCheck');
    await abortable(checkBrowserAvailability(), signal);
    if (!getState().browserAvailable)
      throw new Error(
        'Chrome is unavailable. Install Chrome or choose Computer in Settings.',
      );
    const { DefaultBrowserOperator } = await import(
      '@ui-tars/operator-browser'
    );
    operator = await abortable(
      DefaultBrowserOperator.getInstance(
        false,
        false,
        false,
        false,
        getLocalBrowserSearchEngine(settings.searchEngineForBrowser),
      ),
      signal,
    );
  } else {
    const { NutJSElectronOperator } = await import('../agent/operator');
    signal.throwIfAborted();
    operator = new NutJSElectronOperator(signal);
  }
  signal.throwIfAborted();
  const config = {
    ...getLocalModelConfig(settings),
    model: options?.model || settings.vlmModelName,
    max_tokens: 768,
    providers: {
      mode: settings.providerMode || 'GOOGLE',
      groqApiKey: settings.groqApiKey || '',
      groqModel: settings.groqModel || 'qwen/qwen3.8-27b',
    },
    onVision: options?.onVision,
    onRoute: (r: { model: string; reason: string }) =>
      options?.onRoute?.(r.model, r.reason),
    onWait: (ms: number) =>
      options?.onProgress?.(
        'Waiting for model capacity (' + Math.ceil(ms / 1000) + 's)…',
      ),
  };
  const guiAgent = new GUIAgent({
    model: new GeminiModel(config),
    systemPrompt: getGeminiSystemPrompt(settings.language ?? 'en'),
    logger,
    signal,
    operator,
    maxLoopCount: Math.min(settings.maxLoopCount || 25, 50),
    // The request scheduler handles pacing; no unconditional sleep after a model response.
    loopIntervalInMs: 0,
    uiTarsVersion: getModelVersion(settings.vlmProvider),
    retry: {
      model: { maxRetries: 0 },
      screenshot: { maxRetries: 0 },
      execute: { maxRetries: 0 },
    },
    onData: ({ data }) => {
      if (!current()) return;
      const messages = [...getState().messages, ...data.conversations].slice(
        -32,
      );
      const latestImage = messages.findLastIndex((m) => !!m.screenshotBase64);
      const bounded = messages.map((m, i) =>
        i !== latestImage && m.screenshotBase64
          ? { ...m, screenshotBase64: undefined }
          : m,
      );
      setState({ status: data.status, messages: bounded });
      const last = data.conversations.at(-1);
      if (last?.from === 'gpt') options?.onProgress?.(desktopText(last));
      else if (last?.screenshotBase64)
        options?.onProgress?.('Reading the current screen…');
    },
    onError: ({ error }) => {
      if (current())
        setState({
          status: StatusEnum.ERROR,
          errorMsg: error?.message || 'Desktop task failed.',
        });
    },
  });
  GUIAgentManager.getInstance().setAgent(guiAgent);
  try {
    await abortable(
      guiAgent.run(instructions, getState().sessionHistoryMessages.slice(-6)),
      signal,
    );
    signal.throwIfAborted();
    if (getState().errorMsg) throw new Error(getState().errorMsg!);
  } finally {
    guiAgent.stop();
    if (GUIAgentManager.getInstance().getAgent() === guiAgent)
      GUIAgentManager.getInstance().clearAgent();
  }
};
