/** One cancellation authority for network requests, captures, and uploads. */
export class OperationRegistry {
  private active = new Map<
    string,
    { controller: AbortController; timer: ReturnType<typeof setTimeout> }
  >();
  begin(id: string, timeout = 180000) {
    if (this.active.has(id))
      throw new Error('This operation is already running.');
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            'Operation timed out. Please retry.',
            'TimeoutError',
          ),
        ),
      timeout,
    );
    this.active.set(id, { controller, timer });
    return {
      controller,
      signal: controller.signal,
      finish: () => {
        const operation = this.active.get(id);
        if (operation?.controller === controller) {
          clearTimeout(timer);
          this.active.delete(id);
        }
      },
    };
  }
  cancelAll() {
    for (const { controller, timer } of this.active.values()) {
      clearTimeout(timer);
      controller.abort(new DOMException('Stopped by user.', 'AbortError'));
    }
    this.active.clear();
  }
  get size() {
    return this.active.size;
  }
}

/** Releases UI immediately even when an OS API cannot cancel its native work. */
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
export const operations = new OperationRegistry();
