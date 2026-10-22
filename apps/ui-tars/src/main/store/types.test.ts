import { describe, it, expect } from 'vitest';
import { VLMProviderV2 } from './types';
import { validatePreset } from './validate';

describe('Gemini-only providers', () => {
  it('exposes only Google Gemini', () => {
    expect(Object.values(VLMProviderV2)).toEqual(['Google Gemini']);
  });
  it('rejects non-Google presets', () => {
    expect(() =>
      validatePreset({ vlmProvider: 'Hugging Face for UI-TARS-1.0' }),
    ).toThrow();
  });
});
