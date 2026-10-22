import { describe, expect, it, vi } from 'vitest';
import { UITarsModelVersion } from '@ui-tars/shared/types';
import { GeminiModel } from './GeminiModel';
import { Jimp } from 'jimp';
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
let sequence = 0;
function create(
  status = 200,
  finishReason = 'STOP',
  modelName = 'gemini-3.8-flash',
) {
  const fetcher = vi.fn(
    async (url: any, _options?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(url).endsWith(':countTokens')
            ? { totalTokens: 100 }
            : {
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
              },
        ),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  return {
    fetcher,
    model: new TestModel({
      apiKey: `private-${++sequence}`,
      model: modelName,
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
  it('cancels before sending any request', async () => {
    const { model, fetcher } = create();
    const controller = new AbortController();
    controller.abort();
    await expect(model.request(messages, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('turns a Gemma screenshot response into scaled desktop coordinates', async () => {
    const image = new Jimp({ width: 16, height: 9, color: 0xffffffff });
    const screenshot = (await image.getBuffer('image/png')).toString('base64');
    const fetcher = vi.fn(async (url: any) =>
      Response.json(
        String(url).endsWith(':countTokens')
          ? { totalTokens: 100 }
          : {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    parts: [
                      {
                        text: "Thought: Click target.\nAction: click(start_box='(250,750)')",
                      },
                    ],
                  },
                },
              ],
              usageMetadata: { totalTokenCount: 150 },
            },
      ),
    );
    const model = new GeminiModel({
      model: 'gemma-4-31b-it',
      apiKey: 'gemma-parser-test',
      fetch: fetcher,
    });
    const result = await model.invoke({
      conversations: [
        { from: 'human', value: 'Click target' },
        { from: 'human', value: '<image>' },
      ],
      images: [screenshot],
      screenContext: { width: 1600, height: 900 },
      scaleFactor: 2,
      uiTarsVersion: UITarsModelVersion.V1_0,
    });
    expect(result.parsedPredictions[0]).toMatchObject({
      action_type: 'click',
      action_inputs: {
        start_box: '[0.25,0.75,0.25,0.75]',
        start_coords: [800, 1350],
      },
    });
  });
  it('uses Gemma 4 vision and disables expensive thinking for GUI actions', async () => {
    const { model, fetcher } = create(200, 'STOP', 'gemma-4-31b-it');
    expect((await model.request(messages)).prediction).toBe(
      'Action: finished()',
    );
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toContain('/gemma-4-31b-it:generateContent');
    expect(JSON.parse(options!.body as string).generationConfig).toMatchObject({
      maxOutputTokens: 768,
      thinkingConfig: { thinkingLevel: 'minimal' },
    });
    expect(
      JSON.parse(options!.body as string).contents[0].parts[1],
    ).toHaveProperty('inlineData');
  });
});
