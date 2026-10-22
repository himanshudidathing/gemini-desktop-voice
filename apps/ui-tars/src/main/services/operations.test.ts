import { describe, expect, it, vi, afterEach } from 'vitest';
import { OperationRegistry, abortable } from './operations';
afterEach(() => vi.useRealTimers());
describe('operation lifetime', () => {
  it('aborts all active operations synchronously and permits new operations', () => {
    const r = new OperationRegistry(),
      a = r.begin('a'),
      b = r.begin('b');
    r.cancelAll();
    expect(a.signal.aborted && b.signal.aborted).toBe(true);
    expect(r.size).toBe(0);
    const c = r.begin('c');
    expect(c.signal.aborted).toBe(false);
    c.finish();
  });
  it('ignores late completion from an earlier operation with the same id', () => {
    const r = new OperationRegistry(),
      a = r.begin('a');
    r.cancelAll();
    const b = r.begin('a');
    a.finish();
    expect(r.size).toBe(1);
    b.finish();
  });
  it('releases a blocked native wait immediately without surfacing its late result', async () => {
    const c = new AbortController();
    let release!: (v: string) => void;
    const p = abortable(
      new Promise<string>((resolve) => (release = resolve)),
      c.signal,
    );
    const rejected = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    c.abort();
    await rejected;
    release('late');
  });
  it('terminates hung requests at their deadline and removes timers when settled', async () => {
    vi.useFakeTimers();
    const r = new OperationRegistry(),
      a = r.begin('a', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.signal.reason.name).toBe('TimeoutError');
    a.finish();
    expect(r.size).toBe(0);
  });
});
