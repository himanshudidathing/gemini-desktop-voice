/** Process-local, independent model budgets. No network token-count requests. */
export const GOOGLE_REST_RPM = 30;
export const GOOGLE_REST_TPM = 16000;
const WINDOW_MS = 60000;
type Entry = { at: number; tokens: number; active: boolean };

export function abortableDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export class GoogleRestQuota {
  private entries: Entry[] = [];
  private blockedUntil = 0;
  private lastStart = -Infinity;
  private ticket = 0;
  private queue: number[] = [];

  cooldown(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }

  snapshot(tokens = 0) {
    const now = Date.now();
    this.entries = this.entries.filter(
      (e) => e.active || now - e.at < WINDOW_MS,
    );
    const used = this.entries.reduce((n, e) => n + e.tokens, 0);
    let requests = this.entries.length;
    let remaining = used;
    let wait = Math.max(
      0,
      this.blockedUntil - now,
      this.lastStart + 1000 - now,
    );
    for (const entry of [...this.entries].sort((a, b) => a.at - b.at)) {
      if (requests < GOOGLE_REST_RPM && remaining + tokens <= GOOGLE_REST_TPM)
        break;
      if (entry.active) {
        wait = Math.max(wait, 1000);
        continue;
      }
      wait = Math.max(wait, entry.at + WINDOW_MS - now);
      requests--;
      remaining -= entry.tokens;
    }
    if (requests >= GOOGLE_REST_RPM || remaining + tokens > GOOGLE_REST_TPM)
      wait = Math.max(wait, 1000);
    return {
      requests: this.entries.length,
      tokens: used,
      queued: this.queue.length,
      waitMs: wait,
    };
  }

  async reserve(
    tokens: number,
    signal: AbortSignal,
    onWait?: (ms: number) => void,
  ) {
    if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > GOOGLE_REST_TPM)
      throw new Error(
        'Request exceeds the 16,000-token local budget. Shorten the message or start a new conversation.',
      );
    const ticket = ++this.ticket;
    this.queue.push(ticket);
    try {
      for (;;) {
        signal.throwIfAborted();
        const state = this.snapshot(tokens);
        if (this.queue[0] === ticket && !state.waitMs) {
          const entry: Entry = { at: Date.now(), tokens, active: true };
          this.lastStart = entry.at;
          this.entries.push(entry);
          let settled = false;
          return (actualTokens = tokens) => {
            if (settled) return;
            settled = true;
            entry.active = false;
            // Attribute usage to dispatch time, while never expiring an in-flight reservation.
            if (Number.isSafeInteger(actualTokens) && actualTokens >= 0)
              entry.tokens = actualTokens;
          };
        }
        onWait?.(state.waitMs || 1000);
        await abortableDelay(Math.min(state.waitMs || 50, 250), signal);
      }
    } finally {
      this.queue = this.queue.filter((t) => t !== ticket);
    }
  }
}

// Separate budgets by credential AND model. Google enforces project quotas;
// multiple keys/processes sharing a project still share Google's actual limits.
const quotas = new Map<string, Map<string, GoogleRestQuota>>();
export function getGoogleRestQuota(apiKey: string, model = 'gemma-4-31b-it') {
  let models = quotas.get(apiKey);
  if (!models) {
    models = new Map();
    quotas.set(apiKey, models);
  }
  let quota = models.get(model);
  if (!quota) {
    quota = new GoogleRestQuota();
    models.set(model, quota);
  }
  return quota;
}

export type GoogleBody = {
  contents: object[];
  systemInstruction?: object;
  generationConfig?: Record<string, unknown>;
};

/** Conservative heuristic; reconciled against actual usageMetadata after every response. */
export function estimateGoogleTokens(body: GoogleBody) {
  let tokens = 128;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, any>;
    if (typeof v.text === 'string') {
      const ascii = v.text.replace(/[^\x00-\x7f]/g, '').length;
      tokens += Math.ceil(ascii / 3) + (v.text.length - ascii) * 2 + 8;
    }
    if (v.inlineData) {
      const mime = String(v.inlineData.mimeType);
      // Image allowance includes tiling. Audio uses an intentionally conservative byte estimate.
      tokens += mime.startsWith('image/')
        ? 4096
        : Math.ceil((String(v.inlineData.data).length * 0.75) / 24);
      return;
    }
    for (const [key, child] of Object.entries(v)) {
      if (key !== 'text') {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    }
  };
  visit(body);
  return Math.ceil(tokens * 1.1);
}

export class GoogleRequestError extends Error {
  constructor(public readonly status: number) {
    super(
      `Google request failed (${status}). ${status === 429 ? 'Quota reached; try again after the cooldown.' : 'Check model access and your API key.'}`,
    );
  }
}

export type GoogleRequest = {
  model: string;
  apiKey: string;
  body: GoogleBody;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  onText?: (text: string) => void;
  onWait?: (ms: number) => void;
};

export async function googleGenerateContent({
  model,
  apiKey,
  body,
  signal = AbortSignal.timeout(180000),
  fetcher = fetch,
  onText,
  onWait,
}: GoogleRequest): Promise<any> {
  if (!/^(gemini-[a-zA-Z0-9._-]+|gemma-4-(31b|26b-a4b)-it)$/.test(model))
    throw new Error('Choose a supported Google Gemini or Gemma 4 model ID.');
  if (!apiKey.trim()) throw new Error('Add your Google API key in Settings.');
  const requested = body.generationConfig?.maxOutputTokens;
  if (
    requested !== undefined &&
    (!Number.isSafeInteger(requested) || Number(requested) <= 0)
  )
    throw new Error('Output token limit must be a positive integer.');
  const maxOutputTokens = Math.min(
    typeof requested === 'number' ? requested : 1024,
    2048,
  );
  const quota = getGoogleRestQuota(apiKey, model);
  const reserved = estimateGoogleTokens(body) + maxOutputTokens;
  const settle = await quota.reserve(reserved, signal, onWait);
  const method = onText ? 'streamGenerateContent?alt=sse' : 'generateContent';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal,
        body: JSON.stringify({
          ...body,
          generationConfig: { ...body.generationConfig, maxOutputTokens },
        }),
      },
    );
    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('Retry-After');
        const ms =
          retry && /^\d+(\.\d+)?$/.test(retry)
            ? Number(retry) * 1000
            : retry
              ? Date.parse(retry) - Date.now()
              : 60000;
        quota.cooldown(Number.isFinite(ms) ? Math.max(1000, ms) : 60000);
      }
      await response.body?.cancel();
      throw new GoogleRequestError(response.status);
    }
    if (!onText) {
      const data = await response.json();
      signal.throwIfAborted();
      settle(data.usageMetadata?.totalTokenCount ?? reserved);
      return data;
    }
    if (!response.body) throw new Error('Google returned an empty stream.');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
      text = '',
      final: any = {},
      finished = false;
    const event = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') return;
      const chunk = JSON.parse(data);
      if (chunk.error)
        throw new GoogleRequestError(Number(chunk.error.code) || 500);
      final = { ...final, ...chunk };
      const candidate = chunk.candidates?.[0];
      const delta = (candidate?.content?.parts ?? [])
        .filter((p: any) => !p.thought && p.text)
        .map((p: any) => p.text)
        .join('');
      if (delta) {
        text += delta;
        onText(delta);
      }
      if (candidate?.finishReason) finished = true;
    };
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1024 * 1024)
        throw new Error('Google stream exceeded the event size limit.');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) break;
    }
    if (buffer.trim()) event(buffer);
    signal.throwIfAborted();
    if (!finished)
      throw new Error(
        'The response stream was interrupted. Partial text is retained; retry manually.',
      );
    final.candidates = [
      {
        ...final.candidates?.[0],
        content: { role: 'model', parts: [{ text }] },
      },
    ];
    settle(final.usageMetadata?.totalTokenCount ?? reserved);
    return final;
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    settle();
  }
}
