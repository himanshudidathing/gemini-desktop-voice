import { getGeminiSystemPrompt } from '../shared/modelProviders';
import { UITarsModelVersion } from '@ui-tars/shared/constants';
import {
  Operator,
  SearchEngineForSettings,
  VLMProviderV2,
} from '../store/types';
import { closeScreenMarker } from '../window/ScreenMarker';
import { SearchEngine } from '@ui-tars/operator-browser';

export const getModelVersion = (
  _provider?: VLMProviderV2,
): UITarsModelVersion => UITarsModelVersion.V1_0;
export const getSpByModelVersion = (
  _version: UITarsModelVersion,
  language: 'en' | 'zh',
  _operator: 'browser' | 'computer',
) => getGeminiSystemPrompt(language);

export const getLocalBrowserSearchEngine = (
  engine?: SearchEngineForSettings,
) => {
  return (engine || SearchEngineForSettings.GOOGLE) as unknown as SearchEngine;
};

// Sidebar remains available throughout a task, including its Stop button.
export const beforeAgentRun = async (_operator: Operator) => {};
export const afterAgentRun = (_operator: Operator) => {
  closeScreenMarker();
};
