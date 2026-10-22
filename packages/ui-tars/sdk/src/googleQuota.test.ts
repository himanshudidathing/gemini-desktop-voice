import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleRestQuota, googleGenerateContent } from './googleQuota';
afterEach(() => vi.useRealTimers());
const signal = () => new AbortController().signal;
describe('Google REST rolling quota', () => {
  it('blocks the 31st request until the rolling window expires', async () => {
    vi.useFakeTimers();
    const quota = new GoogleRestQuota();
    await Promise.all(
      Array.from({ length: 30 }, async () =>
        (await quota.reserve(0, signal()))(),
      ),
    );
    let admitted = false;
    const pending = quota.reserve(0, signal()).then((finish) => {
      admitted = true;
      finish();
    });
    await vi.advanceTimersByTimeAsync(59750);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(admitted).toBe(true);
  });
  it('reserves tokens atomically across concurrent callers and releases using actual usage', async () => {
    vi.useFakeTimers();
    const quota = new GoogleRestQuota();
    const finish = await quota.reserve(15000, signal());
    let admitted = false;
    const pending = quota.reserve(2000, signal()).then(() => {
      admitted = true;
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(admitted).toBe(false);
    finish(1000);
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(admitted).toBe(true);
  });
  it('keeps in-flight tokens beyond a minute and lets cancellation stop queued work', async () => {
    vi.useFakeTimers();
    const quota = new GoogleRestQuota();
    await quota.reserve(16000, signal());
    const controller = new AbortController();
    const pending = quota.reserve(1, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(65000);
    controller.abort();
    await rejected;
  });
  it('rejects requests that can never fit', async () => {
    await expect(
      new GoogleRestQuota().reserve(16001, signal()),
    ).rejects.toThrow('16,000');
  });
  it('honors provider cooldown', async () => {
    vi.useFakeTimers();
    const quota = new GoogleRestQuota();
    quota.cooldown(90000);
    let admitted = false;
    const pending = quota.reserve(0, signal()).then(() => {
      admitted = true;
    });
    await vi.advanceTimersByTimeAsync(89750);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await pending;
  });
});
let sequence = 0;
const body = {
  contents: [{ role: 'user', parts: [{ text: 'task' }] }],
  generationConfig: { maxOutputTokens: 8192 },
};
const request = (fetcher: typeof fetch) =>
  googleGenerateContent({
    model: 'gemma-4-31b-it',
    apiKey: `quota-test-${++sequence}`,
    body,
    fetcher,
  });
describe('counted Google transport', () => {
  it('counts the full request, caps output, and returns usage', async () => {
    const fetcher = vi.fn(async (url: any, _options?: RequestInit) =>
      Response.json(
        String(url).endsWith(':countTokens')
          ? { totalTokens: 1200 }
          : { usageMetadata: { totalTokenCount: 1400 } },
      ),
    );
    await request(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const count = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(count.generateContentRequest).toMatchObject({
      model: 'models/gemma-4-31b-it',
      contents: body.contents,
    });
    const generation = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(generation.generationConfig.maxOutputTokens).toBe(2048);
  });
  it('fails closed on oversized or missing token counts without generating', async () => {
    for (const value of [{ totalTokens: 15000 }, {}]) {
      const fetcher = vi.fn(async () => Response.json(value));
      await expect(request(fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('applies Retry-After to subsequent transport calls sharing the key', async () => {
    vi.useFakeTimers();
    const apiKey = `cooldown-test-${++sequence}`;
    const rejected = vi.fn(
      async () =>
        new Response('private', {
          status: 429,
          headers: { 'Retry-After': '90' },
        }),
    );
    await expect(
      googleGenerateContent({
        model: 'gemma-4-31b-it',
        apiKey,
        body,
        fetcher: rejected,
      }),
    ).rejects.toThrow('429');
    const fetcher = vi.fn(async (url: any) =>
      Response.json(
        String(url).endsWith(':countTokens')
          ? { totalTokens: 10 }
          : { usageMetadata: { totalTokenCount: 20 } },
      ),
    );
    const pending = googleGenerateContent({
      model: 'gemini-3.8-flash',
      apiKey,
      body,
      fetcher,
    });
    await vi.advanceTimersByTimeAsync(89750);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not leak error bodies or retry a provider rejection', async () => {
    const fetcher = vi.fn(
      async () => new Response('secret-key', { status: 429 }),
    );
    await expect(request(fetcher)).rejects.toThrow('429');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
