import { describe, expect, it } from 'vitest';
import {
  localIntent,
  classifyRequest,
  FAST_MODEL,
  DEEP_MODEL,
} from './assistant';
describe('local intent matching', () => {
  it.each([
    ['Stop', 'cancel'],
    ['Cancel', 'cancel'],
    ['Abort', 'cancel'],
    ['Pause', 'pause'],
    ['Can you hear me?', 'health'],
    ['Are you listening?', 'health'],
    ['Take screenshot', 'screenshot'],
    ['Start screen recording', 'record-start'],
    ['Stop screen recording', 'record-stop'],
    ['Open settings', 'settings'],
    ['Toggle microphone', 'microphone'],
    ['Minimize sidebar', 'minimize'],
    ['Clear conversation', 'clear'],
    ['What time is it?', 'time'],
    ['Gemini, please stop the task!', 'cancel'],
    ['Could you take a screenshot please?', 'screenshot'],
  ])('routes %s without AI', (text, intent) =>
    expect(localIntent(text)).toBe(intent),
  );
  it.each([
    'Explain stop signs',
    'Do not stop',
    'Cancel my subscription',
    'Take a screenshot and explain it',
    'What does open settings mean?',
    'The code says abort()',
  ])('does not execute controls embedded in %s', (text) =>
    expect(localIntent(text)).toBeNull(),
  );
  it('handles custom names without regex injection', () =>
    expect(localIntent('A.I., stop', 'A.I.')).toBe('cancel'));
});
describe('local capability classifier', () => {
  it.each(['Hello', 'What is a compiler?', 'How are you?'])(
    'routes simple text %s to 26B',
    (text) => expect(classifyRequest(text).model).toBe(FAST_MODEL),
  );
  it.each([
    'Analyze this screenshot',
    'What is on my screen?',
    'Take a screenshot and explain it',
    'Write a Python script',
    'Explain this codebase',
    'Multi-step debugging',
    'Architectural review',
    'Implement a sorting algorithm',
  ])('routes complex %s to 31B', (text) =>
    expect(classifyRequest(text).model).toBe(DEEP_MODEL),
  );
  it('distinguishes conversation, image analysis and explicit desktop actions', () => {
    expect(classifyRequest('Open Chrome').kind).toBe('computer');
    expect(classifyRequest('Open Chrome', 'chat').kind).toBe('chat');
    expect(classifyRequest('What is here?', 'auto', true).kind).toBe('screen');
  });
});

import { desktopText } from './assistant';
it('speaks the final action result rather than action syntax', () => {
  expect(
    desktopText(
      {
        value: "Thought: Done.\nAction: finished(content='Saved')",
        predictionParsed: [
          {
            action_type: 'finished',
            action_inputs: { content: 'Saved the document.' },
          },
        ],
      },
      true,
    ),
  ).toBe('Saved the document.');
});
it('keeps desktop progress free of function arguments', () => {
  expect(
    desktopText({
      value:
        "Thought: Select the search field.\nAction: click(start_box='(400,200)')",
    }),
  ).toBe('Select the search field.');
});
it('does not claim success without a desktop result', () => {
  expect(desktopText(undefined, true)).toBe('Desktop task ended.');
});
