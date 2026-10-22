import { describe, expect, it, vi } from 'vitest';
import { Jimp } from 'jimp';
import { UITarsModelVersion } from '@ui-tars/shared/types';
import { UITarsModel, type UITarsModelConfig } from './Model';

function createModel(
  config: Partial<UITarsModelConfig> = {},
  prediction = "Thought: Click the target.\nAction: click(start_box='(250,750)')",
  finishReason = 'stop',
) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: 'completion-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: finishReason,
              message: { role: 'assistant', content: prediction },
            },
          ],
          usage: { total_tokens: 42 },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const model = new UITarsModel({
    model: 'gemini-test',
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1beta/openai/',
    provider: 'gemini',
    fetch: fetchMock,
    ...config,
  });
  return { model, fetchMock };
}

const invokeParams = {
  conversations: [{ from: 'human' as const, value: 'Click the target' }],
  images: [],
  screenContext: { width: 1600, height: 900 },
  scaleFactor: 2,
  uiTarsVersion: UITarsModelVersion.V1_0,
};

describe('Gemini model requests', () => {
  it('uses Chat Completions even when a preset enables Responses API', async () => {
    const { model, fetchMock } = createModel({ useResponsesApi: true });
    const result = await model.invoke(invokeParams);
    expect(model.useResponsesApi).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe(
      'https://example.test/v1beta/openai/chat/completions',
    );
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      model: 'gemini-test',
      stream: false,
      max_tokens: 8192,
    });
    for (const field of [
      'thinking',
      'provider',
      'useResponsesApi',
      'seed',
      'stop',
      'frequency_penalty',
      'presence_penalty',
    ]) {
      expect(body).not.toHaveProperty(field);
    }
    expect(result.costTokens).toBe(42);
    expect(result.parsedPredictions[0]).toMatchObject({
      action_type: 'click',
      action_inputs: {
        start_box: '[0.25,0.75,0.25,0.75]',
        start_coords: [800, 1350],
      },
    });
  });

  it('sends screenshots as inline PNGs with task history', async () => {
    const { model, fetchMock } = createModel();
    const image = new Jimp({ width: 16, height: 9, color: 0xffffffff });
    const png = (await image.getBuffer('image/png')).toString('base64');
    await model.invoke({
      ...invokeParams,
      conversations: [
        ...invokeParams.conversations,
        { from: 'human', value: '<image>' },
      ],
      images: [png],
    });
    const [, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(options.body as string);
    expect(JSON.stringify(body.messages)).toContain('Click the target');
    expect(JSON.stringify(body.messages)).toContain('data:image/png;base64,');
  });

  it('preserves UI-TARS request parameters and token defaults', async () => {
    const { model, fetchMock } = createModel({ provider: 'ui-tars' });
    await model.invoke(invokeParams);
    const [, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(options.body as string)).toMatchObject({
      thinking: { type: 'disabled' },
      max_tokens: 1000,
    });
  });

  it('does not execute truncated Gemini actions', async () => {
    const { model } = createModel(
      {},
      "Action: click(start_box='(250,750)')",
      'length',
    );
    await expect(model.invoke(invokeParams)).rejects.toThrow(
      'Gemini output was truncated',
    );
  });

  it('surfaces empty model responses', async () => {
    const { model } = createModel({}, '');
    await expect(model.invoke(invokeParams)).rejects.toThrow();
  });

  it('passes cancellation through to the request', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortFetch = vi.fn(async () => {
      throw new Error('should not fetch');
    });
    const { model } = createModel({ fetch: abortFetch });
    // Abort is handled by the OpenAI transport before network I/O.
    const { setContext, useContext } = await import('./context/useContext');
    const context = useContext();
    setContext({ ...context, signal: controller.signal });
    try {
      await expect(model.invoke(invokeParams)).rejects.toThrow();
      expect(abortFetch).not.toHaveBeenCalled();
    } finally {
      setContext(context);
    }
  });
});
