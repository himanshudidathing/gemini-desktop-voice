import { describe, expect, it, vi } from 'vitest';
import { UITarsModelVersion } from '@ui-tars/shared/types';
import { GeminiModel } from './GeminiModel';
class TestModel extends GeminiModel {
  request(messages: any[], signal?: AbortSignal) {
    return this.invokeModelProvider(
      UITarsModelVersion.V1_0,
      { messages },
      { signal },
    );
  }
}
const messages = [
  { role: 'system', content: 'Choose a single action.' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Open Chrome' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ],
  },
  { role: 'assistant', content: "Action: click(start_box='(500,500)')" },
];
function create(status = 200, finishReason = 'STOP') {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason,
              content: {
                parts: [
                  { thought: true, text: 'hidden' },
                  { text: 'Action: finished()' },
                ],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 10 },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  return {
    fetcher,
    model: new TestModel({
      apiKey: 'private',
      model: 'gemini-3.8-flash',
      baseURL: 'https://not-google.test',
      fetch: fetcher,
    }),
  };
}
describe('Google-only native Gemini transport', () => {
  it('maps screenshots, system prompts, and assistant history to native generateContent', async () => {
    const { model, fetcher } = create();
    const result = await model.request(messages);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    const body = JSON.parse(options.body as string);
    expect(body.systemInstruction.parts).toEqual([
      { text: 'Choose a single action.' },
    ]);
    expect(body.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'AQID' },
    });
    expect(body.contents[1].role).toBe('model');
    expect(result).toMatchObject({
      prediction: 'Action: finished()',
      costTokens: 10,
    });
    expect(JSON.stringify(model)).not.toContain('private');
  });
  it('omits empty system instructions', async () => {
    const { model, fetcher } = create();
    await model.request([{ role: 'user', content: 'hello' }]);
    const [, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(options.body as string)).not.toHaveProperty(
      'systemInstruction',
    );
  });
  it('rejects other model providers', () => {
    expect(() => new GeminiModel({ model: 'other-model' })).toThrow();
  });
  it('does not execute truncated or blocked actions', async () => {
    await expect(
      create(200, 'MAX_TOKENS').model.request(messages),
    ).rejects.toThrow('truncated');
    await expect(create(200, 'SAFETY').model.request(messages)).rejects.toThrow(
      'SAFETY',
    );
  });
  it('surfaces Google quota errors', async () => {
    await expect(create(429).model.request(messages)).rejects.toThrow('429');
  });
  it('passes caller cancellation into the native request', async () => {
    const { model, fetcher } = create();
    const controller = new AbortController();
    controller.abort();
    await model.request(messages, controller.signal);
    const [, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(options.signal?.aborted).toBe(true);
  });
});
