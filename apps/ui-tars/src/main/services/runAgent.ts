/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { logger } from '@main/logger';
import { StatusEnum } from '@ui-tars/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@ui-tars/sdk';
import { markClickPosition } from '@main/utils/image';
import { UTIOService } from '@main/services/utio';
import { NutJSElectronOperator } from '../agent/operator';
import { DefaultBrowserOperator } from '@ui-tars/operator-browser';
import { showPredictionMarker } from '@main/window/ScreenMarker';
import { SettingStore } from '@main/store/setting';
import { AppState, Operator } from '@main/store/types';
import { GUIAgentManager } from '../ipcRoutes/agent';
import { checkBrowserAvailability } from './browserCheck';
import {
  getModelVersion,
  beforeAgentRun,
  afterAgentRun,
  getLocalBrowserSearchEngine,
} from '../utils/agent';
import { GeminiModel } from '@ui-tars/sdk/core';
import {
  getLocalModelConfig,
  getGeminiSystemPrompt,
} from '../shared/modelProviders';

export const runAgent = async (
  setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  logger.info('runAgent');
  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  if (
    ![Operator.LocalComputer, Operator.LocalBrowser].includes(settings.operator)
  ) {
    throw new Error(
      'Gemini Desktop supports local computer and browser operators only.',
    );
  }
  const language = settings.language ?? 'en';

  logger.info('settings.operator', settings.operator);

  const handleData: GUIAgentConfig<NutJSElectronOperator>['onData'] = async ({
    data,
  }) => {
    const lastConv = getState().messages[getState().messages.length - 1];
    const { status, conversations, ...restUserData } = data;
    logger.info('[onGUIAgentData] status', status, conversations.length);

    // add SoM to conversations
    const conversationsWithSoM: ConversationWithSoM[] = await Promise.all(
      conversations.map(async (conv) => {
        const { screenshotContext, predictionParsed } = conv;
        if (
          lastConv?.screenshotBase64 &&
          screenshotContext?.size &&
          predictionParsed
        ) {
          const screenshotBase64WithElementMarker = await markClickPosition({
            screenshotContext,
            base64: lastConv?.screenshotBase64,
            parsed: predictionParsed,
          }).catch((e) => {
            logger.error('[markClickPosition error]:', e);
            return '';
          });
          return {
            ...conv,
            screenshotBase64WithElementMarker,
          };
        }
        return conv;
      }),
    ).catch((e) => {
      logger.error('[conversationsWithSoM error]:', e);
      return conversations;
    });

    const {
      screenshotBase64,
      predictionParsed,
      screenshotContext,
      screenshotBase64WithElementMarker,
      ...rest
    } = conversationsWithSoM?.[conversationsWithSoM.length - 1] || {};
    logger.info(
      '[onGUIAgentData] ======data======\n',
      predictionParsed,
      screenshotContext,
      rest,
      status,
      '\n========',
    );

    if (
      settings.operator === Operator.LocalComputer &&
      predictionParsed?.length &&
      screenshotContext?.size &&
      !abortController?.signal?.aborted
    ) {
      showPredictionMarker(predictionParsed, screenshotContext);
    }

    setState({
      ...getState(),
      status,
      restUserData,
      messages: [...(getState().messages || []), ...conversationsWithSoM],
    });
  };

  let operator: NutJSElectronOperator | DefaultBrowserOperator;

  switch (settings.operator) {
    case Operator.LocalComputer:
      operator = new NutJSElectronOperator();
      break;
    case Operator.LocalBrowser:
      await checkBrowserAvailability();
      const { browserAvailable } = getState();
      if (!browserAvailable) {
        setState({
          ...getState(),
          status: StatusEnum.ERROR,
          errorMsg:
            'Browser is not available. Please install Chrome and try again.',
        });
        return;
      }

      operator = await DefaultBrowserOperator.getInstance(
        false,
        false,
        false,
        getState().status === StatusEnum.CALL_USER,
        getLocalBrowserSearchEngine(settings.searchEngineForBrowser),
      );
      break;
    default:
      break;
  }

  const modelVersion = getModelVersion(settings.vlmProvider);
  const modelConfig = getLocalModelConfig(settings);
  const systemPrompt = getGeminiSystemPrompt(language);

  const guiAgent = new GUIAgent({
    model: new GeminiModel(modelConfig),
    systemPrompt: systemPrompt,
    logger,
    signal: abortController?.signal,
    operator: operator!,
    onData: handleData,
    onError: (params) => {
      const { error } = params;
      logger.error('[onGUIAgentError]', error);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: JSON.stringify({
          status: error?.status,
          message: error?.message,
          stack: error?.stack,
        }),
      });
    },
    retry: {
      model: {
        maxRetries: 5,
      },
      screenshot: {
        maxRetries: 5,
      },
      execute: {
        maxRetries: 1,
      },
    },
    maxLoopCount: settings.maxLoopCount,
    loopIntervalInMs: settings.loopIntervalInMs,
    uiTarsVersion: modelVersion,
  });

  GUIAgentManager.getInstance().setAgent(guiAgent);
  UTIOService.getInstance().sendInstruction(instructions);

  const { sessionHistoryMessages } = getState();

  beforeAgentRun(settings.operator);

  const startTime = Date.now();

  await guiAgent.run(instructions, sessionHistoryMessages).catch((e) => {
    logger.error('[runAgentLoop error]', e);
    setState({
      ...getState(),
      status: StatusEnum.ERROR,
      errorMsg: e.message,
    });
  });

  logger.info('[runAgent Totoal cost]: ', (Date.now() - startTime) / 1000, 's');

  afterAgentRun(settings.operator);
};
