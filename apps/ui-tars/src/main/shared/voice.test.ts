import { describe, expect, it } from 'vitest';
import { createLiveSetup, WakeGate } from './voice';

describe('name activation', () => {
  it('ignores background commands and partial name matches', () => {
    const gate = new WakeGate('Gemini');
    expect(gate.consume('open the browser').kind).toBe('ignore');
    expect(gate.consume('Geminis open the browser').kind).toBe('ignore');
  });
  it('strips the greeting/name and keeps the full task', () => {
    expect(
      new WakeGate('Gemini').consume(
        'Hey GEMINI, open Chrome and search for cats',
      ),
    ).toEqual({ kind: 'task', text: 'open Chrome and search for cats' });
  });
  it('supports name-only activation for 12 seconds and consumes it once', () => {
    let now = 1000;
    const gate = new WakeGate('Gemini', () => now);
    expect(gate.consume('Gemini').kind).toBe('wake');
    now += 11000;
    expect(gate.consume('open the browser').kind).toBe('task');
    expect(gate.consume('another task').kind).toBe('ignore');
    gate.consume('Gemini');
    now += 13000;
    expect(gate.consume('open the browser').kind).toBe('ignore');
  });
  it('supports custom names, punctuation, and Unicode', () => {
    expect(new WakeGate('A.I.').consume('A.I., open Chrome').kind).toBe('task');
    expect(new WakeGate('A.I.').consume('AxIy open Chrome').kind).toBe(
      'ignore',
    );
    expect(new WakeGate('मित्र').consume('मित्र, ब्राउज़र खोलो').text).toBe(
      'ब्राउज़र खोलो',
    );
  });
  it.each(['Gemini stop', 'Gemini, cancel the task', 'Gemini please stop now'])(
    'recognizes cancellation: %s',
    (text) => {
      expect(new WakeGate('Gemini').consume(text).kind).toBe('stop');
    },
  );
  it('does not confuse tasks containing stop with cancellation', () => {
    expect(
      new WakeGate('Gemini').consume('Gemini, search for bus stops').kind,
    ).toBe('task');
  });
  it('clears the wake window on disconnect', () => {
    const gate = new WakeGate('Gemini');
    gate.consume('Gemini');
    gate.reset();
    expect(gate.consume('open browser').kind).toBe('ignore');
  });
});

describe('Live setup', () => {
  const settings = {
    apiKey: 'secret',
    model: 'gemini-3.8-live',
    assistantName: 'Gemini',
    voiceName: 'Aoede',
  };
  it('requests native audio with input/output transcripts and no desktop tools', () => {
    const setup = createLiveSetup(settings).setup;
    expect(setup.model).toBe('models/gemini-3.8-live');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup).toHaveProperty('inputAudioTranscription');
    expect(setup).not.toHaveProperty('tools');
    expect(JSON.stringify(setup)).not.toContain('secret');
  });
  it('rejects a different provider, invalid name, or invalid voice', () => {
    expect(() =>
      createLiveSetup({ ...settings, model: 'other-model' }),
    ).toThrow();
    expect(() => createLiveSetup({ ...settings, assistantName: '' })).toThrow();
    expect(() =>
      createLiveSetup({ ...settings, voiceName: 'unknown' }),
    ).toThrow();
  });
});
