import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  generateWithProviders,
  groqQuotas,
  getGroqQuota,
  GroqRequestError,
} from './providers';
import { parseVision, visionAction } from './vision';
const good = (text = 'Hello') =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { total_tokens: 10 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
const google = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'Google reply' }] },
        },
      ],
      usageMetadata: { totalTokenCount: 12 },
    }),
  );
const req = (overrides: any = {}) => ({
  apiKey: 'google-' + Math.random(),
  model: 'gemma-4-26b-a4b-it',
  signal: new AbortController().signal,
  body: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
  providers: {
    mode: 'BOTH' as const,
    groqApiKey: 'groq-test',
    groqModel: 'qwen/qwen3.8-27b',
  },
  ...overrides,
});
beforeEach(() => {
  groqQuotas.clear();
});
afterEach(() => vi.useRealTimers());
it('uses Groq first in BOTH without any Google preflight', async () => {
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
    good(),
  );
  const route = vi.fn();
  await generateWithProviders(req({ fetcher, onRoute: route }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://api.groq.com/openai/v1/chat/completions',
  );
  expect(route.mock.calls[0][0].model).toBe('qwen/qwen3.8-27b');
});
it('never sends a Groq request in GOOGLE mode', async () => {
  const r = req();
  r.providers.mode = 'GOOGLE' as any;
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
    google(),
  );
  await generateWithProviders({ ...r, fetcher });
  expect(String(fetcher.mock.calls[0][0])).toContain('googleapis.com');
});
it('fails over on Groq 429, then recovers after its cooldown', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    )
    .mockResolvedValueOnce(google());
  await generateWithProviders(req({ fetcher }));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(getGroqQuota('groq-test').snapshot().waitMs).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(61000);
  const recovered = vi.fn(async (_url: unknown, _options?: RequestInit) =>
    good(),
  );
  await generateWithProviders(req({ fetcher: recovered }));
  expect(String(recovered.mock.calls[0][0])).toContain('api.groq.com');
});
it('skips a locally saturated Groq budget without wasting a request', async () => {
  getGroqQuota('groq-test').cooldown(60000);
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
    google(),
  );
  await generateWithProviders(req({ fetcher }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain('googleapis.com');
});
it('never crosses providers in GROQ-only mode', async () => {
  const fetcher = vi.fn(
    async (_url: unknown, _options?: RequestInit) =>
      new Response('', { status: 503 }),
  );
  await expect(
    generateWithProviders(
      req({
        fetcher,
        providers: {
          mode: 'GROQ',
          groqApiKey: 'groq-test',
          groqModel: 'qwen/qwen3.8-27b',
        },
      }),
    ),
  ).rejects.toBeInstanceOf(GroqRequestError);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not fail over after partial streaming output', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"code":503}}\n\n',
      ),
  );
  const text = vi.fn();
  await expect(
    generateWithProviders(req({ fetcher, onText: text })),
  ).rejects.toThrow();
  expect(text).toHaveBeenCalledWith('partial');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects a truncated stream, preserving its text', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
  );
  const text = vi.fn();
  await expect(
    generateWithProviders(req({ fetcher, onText: text })),
  ).rejects.toThrow('incomplete');
  expect(text).toHaveBeenCalledWith('partial');
});
it('passes cancellation to the active Groq request and does not fail over', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async (_url, options) => {
    controller.abort();
    options.signal.throwIfAborted();
    return good();
  });
  await expect(
    generateWithProviders(req({ fetcher, signal: controller.signal })),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
const vision = {
  summary: 'Click the search field',
  elements: [
    {
      id: 'search',
      label: 'Search',
      box: [100, 200, 500, 300],
      confidence: 0.9,
    },
  ],
  nextAction: { type: 'click', targetId: 'search' },
};
it('turns a validated box into one centered normalized action', async () => {
  const onVision = vi.fn(),
    fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      good(JSON.stringify(vision)),
    );
  const result = await generateWithProviders(
    req({ fetcher, vision: 'automation', onVision }),
  );
  expect(onVision).toHaveBeenCalled();
  expect(result.candidates[0].content.parts[0].text).toContain(
    "click(start_box='(300,250)')",
  );
  expect(
    JSON.parse(String(fetcher.mock.calls[0][1]!.body)).response_format,
  ).toEqual({
    type: 'json_object',
  });
});
it.each([
  {
    ...vision,
    elements: [{ ...vision.elements[0], box: [100, 200, 1200, 300] }],
  },
  {
    ...vision,
    elements: [{ ...vision.elements[0], box: [500, 200, 100, 300] }],
  },
  { ...vision, elements: [vision.elements[0], vision.elements[0]] },
])('rejects invalid bounding boxes before execution', (v) =>
  expect(() => parseVision(JSON.stringify(v))).toThrow(),
);
it('rejects uncertain or missing targets', () => {
  expect(() =>
    visionAction({
      ...vision,
      elements: [{ ...vision.elements[0], confidence: 0.2 }],
    } as any),
  ).toThrow('uncertain');
  expect(() =>
    visionAction({
      ...vision,
      nextAction: { type: 'click', targetId: 'missing' },
    } as any),
  ).toThrow();
});

it('falls back after the 30th local Groq dispatch without making a 31st request', async () => {
  vi.useFakeTimers();
  const q = getGroqQuota('groq-test');
  for (let i = 0; i < 30; i++) {
    const settle = await q.reserve(1, new AbortController().signal);
    settle(1);
    await vi.advanceTimersByTimeAsync(1000);
  }
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
    google(),
  );
  await generateWithProviders(req({ fetcher }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain('googleapis.com');
});
