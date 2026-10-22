import { describe, expect, it } from 'vitest';
import {
  getLocalModelConfig,
  getGeminiSystemPrompt,
  GEMINI_BASE_URL,
} from './modelProviders';
import { Operator, VLMProviderV2 } from '../store/types';
import { validatePreset } from '../store/validate';

const settings = {
  vlmProvider: VLMProviderV2.gemini,
  vlmBaseUrl: GEMINI_BASE_URL,
  vlmApiKey: 'test-key',
  vlmModelName: 'gemini-custom-vision-model',
  useResponsesApi: true,
  operator: Operator.LocalComputer,
};

describe('desktop Gemini configuration', () => {
  it('accepts Gemini presets and preserves custom model IDs', () => {
    const preset = validatePreset(settings);
    expect(getLocalModelConfig(preset)).toEqual({
      baseURL: GEMINI_BASE_URL,
      apiKey: 'test-key',
      model: settings.vlmModelName,
      provider: 'gemini',
      useResponsesApi: false,
    });
  });

  it('accepts hosted Gemma 4 presets while Live remains Gemini', () => {
    const preset = validatePreset({
      ...settings,
      vlmModelName: 'gemma-4-31b-it',
      liveModelName: 'gemini-3.8-live',
    });
    expect(getLocalModelConfig(preset).model).toBe('gemma-4-31b-it');
    expect(() =>
      validatePreset({ ...settings, liveModelName: 'gemma-4-31b-it' }),
    ).toThrow();
  });

  it('always uses Google and disables Responses API', () => {
    expect(
      getLocalModelConfig({ ...settings, vlmBaseUrl: 'https://example.test' }),
    ).toMatchObject({
      baseURL: GEMINI_BASE_URL,
      provider: 'gemini',
      useResponsesApi: false,
    });
  });
  it('rejects non-Gemini model IDs', () => {
    expect(() =>
      getLocalModelConfig({ ...settings, vlmModelName: 'other-model' }),
    ).toThrow();
  });

  it('specifies normalized x,y coordinates and the instruction marker', () => {
    expect(getGeminiSystemPrompt('en')).toContain('normalized from 0 to 1000');
    expect(getGeminiSystemPrompt('en')).toContain('(x,y) order');
    expect(getGeminiSystemPrompt('en')).toContain('English');
    expect(getGeminiSystemPrompt('zh')).toContain('Chinese');
    expect(getGeminiSystemPrompt('en')).toContain('## User Instruction');
  });
});
