import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGeminiEnvironment, resolveGeminiEnvironment } from './environment';
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('gemini-env-test-')
    )
      throw new Error('Refusing to remove an unexpected test directory.');
    rmSync(directory, { recursive: true, force: true });
  }
});
describe('Gemini environment configuration', () => {
  it('uses app defaults without an API key', () => {
    const result = resolveGeminiEnvironment({});
    expect(result.defaults).toMatchObject({
      vlmApiKey: '',
      assistantName: 'Gemini',
      voiceName: 'Aoede',
    });
    expect(result.overrides).toEqual({});
  });
  it('allows Gemma tasks while rejecting Gemma as the Live model', () => {
    expect(
      resolveGeminiEnvironment({ GEMINI_MODEL: 'gemma-4-31b-it' }).defaults
        .vlmModelName,
    ).toBe('gemma-4-31b-it');
    expect(() =>
      resolveGeminiEnvironment({ GEMINI_LIVE_MODEL: 'gemma-4-31b-it' }),
    ).toThrow();
  });
  it('maps every documented environment variable to the running app', () => {
    expect(
      resolveGeminiEnvironment({
        GEMINI_API_KEY: ' test-key ',
        GEMINI_MODEL: 'gemini-task',
        GEMINI_LIVE_MODEL: 'gemini-live',
        GEMINI_ASSISTANT_NAME: 'Nova',
        GEMINI_VOICE: 'Kore',
      }).overrides,
    ).toEqual({
      vlmApiKey: 'test-key',
      vlmModelName: 'gemini-task',
      liveModelName: 'gemini-live',
      assistantName: 'Nova',
      voiceName: 'Kore',
    });
  });
  it('loads the root .env when Electron runs from apps/ui-tars, preserving process environment priority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gemini-env-test-'));
    temporaryDirectories.push(directory);
    const appDirectory = join(directory, 'apps', 'ui-tars');
    mkdirSync(appDirectory, { recursive: true });
    writeFileSync(
      join(directory, '.env'),
      [
        'GEMINI_API_KEY=test-root-key',
        'GEMINI_MODEL=gemini-root',
        'GEMINI_VOICE=Kore',
      ].join(String.fromCharCode(10)),
    );
    writeFileSync(join(appDirectory, '.env'), 'GEMINI_VOICE=Puck');
    const environment = { GEMINI_MODEL: 'gemini-shell' };
    expect(
      loadGeminiEnvironment({ cwd: appDirectory, appDirectory, environment })
        .defaults,
    ).toMatchObject({
      vlmApiKey: 'test-root-key',
      vlmModelName: 'gemini-shell',
      voiceName: 'Puck',
    });
  });
  it('rejects invalid model IDs, voice names, and activation names', () => {
    expect(() =>
      resolveGeminiEnvironment({ GEMINI_MODEL: 'other-provider' }),
    ).toThrow();
    expect(() =>
      resolveGeminiEnvironment({ GEMINI_LIVE_MODEL: '../escape' }),
    ).toThrow();
    expect(() =>
      resolveGeminiEnvironment({ GEMINI_VOICE: 'Unknown' }),
    ).toThrow();
    expect(() =>
      resolveGeminiEnvironment({ GEMINI_ASSISTANT_NAME: 'X' }),
    ).toThrow();
  });
  it('does not overwrite saved settings from blank variables', () => {
    expect(
      resolveGeminiEnvironment({ GEMINI_API_KEY: '', GEMINI_MODEL: ' ' })
        .overrides,
    ).toEqual({});
  });
});

it('keeps Google speech independent of Groq-only reasoning selection', () => {
  const result = resolveGeminiEnvironment({
    MODEL: 'GROQ',
    GROQ_API_KEY: 'groq-test',
    GROQ_MODEL: 'qwen/qwen3.8-27b',
    GOOGLE_STT_MODEL: 'gemini-3.5-transcribe-live',
    GOOGLE_TTS_MODEL: 'gemini-3.8-flash-lite-tts',
  });
  expect(result.defaults.providerMode).toBe('GROQ');
  expect(result.defaults.groqApiKey).toBe('groq-test');
  expect(result.defaults.speechInputModel).toBe('gemini-3.5-transcribe-live');
  expect(result.defaults.speechOutputModel).toBe('gemini-3.8-flash-lite-tts');
});
it('rejects unsupported provider modes and malformed Groq IDs', () => {
  expect(() => resolveGeminiEnvironment({ MODEL: 'GROK' })).toThrow('MODEL');
  expect(() => resolveGeminiEnvironment({ GROQ_MODEL: 'not a model' })).toThrow(
    'GROQ_MODEL',
  );
});
