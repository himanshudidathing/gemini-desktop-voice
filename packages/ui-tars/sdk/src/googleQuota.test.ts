import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleRestQuota,
  googleGenerateContent,
  getGoogleRestQuota,
  estimateGoogleTokens,
} from './googleQuota';
import { googleRoutedGenerate, FAST_MODEL, DEEP_MODEL } from './googleRouting';
afterEach(() => vi.useRealTimers());
const signal = () => new AbortController().signal;
const body = { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] };
let seq = 0;
const request = () => ({
  model: FAST_MODEL,
  apiKey: 'quota-test-' + ++seq,
  body,
});
const response = () =>
  Response.json({
    candidates: [
      { finishReason: 'STOP', content: { parts: [{ text: 'Hello' }] } },
    ],
    usageMetadata: { totalTokenCount: 20 },
  });
describe('independent rolling model budgets', () => {
  it('dispatches immediately then paces closely spaced calls by one second', async () => {
    vi.useFakeTimers();
    const q = new GoogleRestQuota();
    (await q.reserve(10, signal()))();
    let ready = false;
    const p = q.reserve(10, signal()).then((done) => {
      ready = true;
      done();
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(ready).toBe(true);
  });
  it('admits 30 requests and holds the 31st until the rolling minute', async () => {
    vi.useFakeTimers();
    const q = new GoogleRestQuota();
    for (let i = 0; i < 30; i++) {
      (await q.reserve(0, signal()))();
      if (i < 29) await vi.advanceTimersByTimeAsync(1000);
    }
    let ready = false;
    const p = q.reserve(0, signal()).then((done) => {
      ready = true;
      done();
    });
    await vi.advanceTimersByTimeAsync(30999);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(ready).toBe(true);
  });
  it('reserves concurrent tokens and reconciles actual usage without double settlement', async () => {
    vi.useFakeTimers();
    const q = new GoogleRestQuota();
    const done = await q.reserve(15000, signal());
    let ready = false;
    const p = q.reserve(2000, signal()).then((f) => {
      ready = true;
      f();
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ready).toBe(false);
    done(200);
    done();
    await vi.advanceTimersByTimeAsync(250);
    await p;
    expect(q.snapshot().tokens).toBe(2200);
  });
  it('holds in-flight tokens beyond a minute and cancels queue wait immediately', async () => {
    vi.useFakeTimers();
    const q = new GoogleRestQuota();
    await q.reserve(16000, signal());
    const c = new AbortController();
    const p = q.reserve(1, c.signal);
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(61000);
    expect(q.snapshot().tokens).toBe(16000);
    c.abort();
    await assertion;
    expect(q.snapshot().queued).toBe(0);
  });
  it('keeps model limits independent', () => {
    const key = 'independent';
    expect(getGoogleRestQuota(key, FAST_MODEL)).not.toBe(
      getGoogleRestQuota(key, DEEP_MODEL),
    );
    getGoogleRestQuota(key, FAST_MODEL).cooldown(60000);
    expect(getGoogleRestQuota(key, DEEP_MODEL).snapshot().waitMs).toBe(0);
  });
  it('rejects impossible requests instead of waiting forever', async () => {
    await expect(
      new GoogleRestQuota().reserve(16001, signal()),
    ).rejects.toThrow('16,000');
  });
});
describe('one-request native transport', () => {
  it('makes exactly one generation request and never calls countTokens', async () => {
    const fetcher = vi.fn(async (_url: any, _options?: RequestInit) =>
      response(),
    );
    await googleGenerateContent({ ...request(), fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain(':generateContent');
  });
  it('estimates image and text cost locally and rejects huge context before I/O', async () => {
    const fetcher = vi.fn(async (_url: any, _options?: RequestInit) =>
      response(),
    );
    const b = { contents: [{ parts: [{ text: 'x'.repeat(60000) }] }] };
    expect(estimateGoogleTokens(b)).toBeGreaterThan(16000);
    await expect(
      googleGenerateContent({ ...request(), body: b, fetcher }),
    ).rejects.toThrow('16,000');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('passes cancellation to fetch and never sends a cancelled request', async () => {
    const c = new AbortController();
    c.abort();
    const fetcher = vi.fn(async (_url: any, _options?: RequestInit) =>
      response(),
    );
    await expect(
      googleGenerateContent({ ...request(), fetcher, signal: c.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('streams fragmented SSE frames, excludes thought text, and records actual tokens', async () => {
    const r = request(),
      deltas: string[] = [];
    const data = [
      'data: ' +
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ thought: true, text: 'hidden' }, { text: 'Hi ' }],
              },
            },
          ],
        }) +
        '\r\n\r\n',
      'data: ' +
        JSON.stringify({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: 'there' }] } },
          ],
          usageMetadata: { totalTokenCount: 9 },
        }) +
        '\n\n',
    ].join('');
    const bytes = new TextEncoder().encode(data);
    const fetcher = vi.fn(
      async (_url: any, _options?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(c) {
              for (let i = 0; i < bytes.length; i += 7)
                c.enqueue(bytes.slice(i, i + 7));
              c.close();
            },
          }),
        ),
    );
    const result = await googleGenerateContent({
      ...r,
      fetcher,
      onText: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe('Hi there');
    expect(result.candidates[0].content.parts[0].text).toBe('Hi there');
    expect(getGoogleRestQuota(r.apiKey, r.model).snapshot().tokens).toBe(9);
  });
  it('fails over once on 429 to the alternate model with independent cooldown', async () => {
    const r = request();
    const models: string[] = [];
    const fetcher = vi.fn(async (url: any) =>
      String(url).includes(FAST_MODEL)
        ? new Response('secret', {
            status: 429,
            headers: { 'Retry-After': '90' },
          })
        : response(),
    );
    await googleRoutedGenerate({
      ...r,
      fetcher,
      onRoute: (r) => models.push(r.model),
    });
    expect(models).toEqual([FAST_MODEL, DEEP_MODEL]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      getGoogleRestQuota(r.apiKey, FAST_MODEL).snapshot().waitMs,
    ).toBeGreaterThan(88000);
    expect(getGoogleRestQuota(r.apiKey, DEEP_MODEL).snapshot().requests).toBe(
      1,
    );
  });
  it('selects the available model before sending and never retries authentication failures', async () => {
    const r = request();
    getGoogleRestQuota(r.apiKey, FAST_MODEL).cooldown(60000);
    const fetcher = vi.fn(
      async (_url: any, _options?: RequestInit) =>
        new Response('secret-key', { status: 403 }),
    );
    await expect(googleRoutedGenerate({ ...r, fetcher })).rejects.toThrow(
      '403',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain(DEEP_MODEL);
  });
  it('does not fail over after partial output or a broken stream', async () => {
    const fetcher = vi.fn(
      async (_url: any, _options?: RequestInit) =>
        new Response(
          'data: ' +
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: 'Partial' }] } }],
            }) +
            '\n\n',
        ),
    );
    const output: string[] = [];
    await expect(
      googleRoutedGenerate({
        ...request(),
        fetcher,
        onText: (t) => output.push(t),
      }),
    ).rejects.toThrow('interrupted');
    expect(output).toEqual(['Partial']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
