/** Shared process-local REST quota, including countTokens requests. */
export const GOOGLE_REST_RPM = 30;
export const GOOGLE_REST_TPM = 16000;
const WINDOW_MS = 60000;
type Entry = { at: number; tokens: number; active: boolean };

export class GoogleRestQuota {
  private entries: Entry[] = [];
  private blockedUntil = 0;

  cooldown(milliseconds: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + milliseconds);
  }

  async reserve(tokens: number, signal: AbortSignal) {
    if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > GOOGLE_REST_TPM)
      throw new Error(
        'Request exceeds the 16,000-token budget. Start a new task or use a shorter recording.',
      );
    for (;;) {
      signal.throwIfAborted();
      const now = Date.now();
      this.entries = this.entries.filter(
        (entry) => entry.active || now - entry.at < WINDOW_MS,
      );
      if (
        now >= this.blockedUntil &&
        this.entries.length < GOOGLE_REST_RPM &&
        this.entries.reduce((total, entry) => total + entry.tokens, 0) +
          tokens <=
          GOOGLE_REST_TPM
      ) {
        const entry = { at: now, tokens, active: true };
        this.entries.push(entry);
        return (actualTokens = tokens) => {
          // Hold in-flight reservations, then retain usage for 60s after completion.
          entry.at = Date.now();
          entry.active = false;
          if (Number.isSafeInteger(actualTokens) && actualTokens >= 0)
            entry.tokens = actualTokens;
        };
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 250);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}

// One budget across models, tasks, availability checks, and uploads using a key.
// Credentials remain in memory only and are never included in errors or logs.
const quotas = new Map<string, GoogleRestQuota>();
export function getGoogleRestQuota(apiKey: string) {
  let quota = quotas.get(apiKey);
  if (!quota) {
    quota = new GoogleRestQuota();
    quotas.set(apiKey, quota);
  }
  return quota;
}

export async function googleGenerateContent({
  model,
  apiKey,
  body,
  signal = AbortSignal.timeout(180000),
  fetcher = fetch,
}: {
  model: string;
  apiKey: string;
  body: {
    contents: object[];
    systemInstruction?: object;
    generationConfig?: Record<string, unknown>;
  };
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}) {
  if (!/^(gemini-[a-zA-Z0-9._-]+|gemma-4-(31b|26b-a4b)-it)$/.test(model))
    throw new Error('Choose a supported Google Gemini or Gemma 4 model ID.');
  if (!apiKey.trim()) throw new Error('Enter a Google API key.');
  const quota = getGoogleRestQuota(apiKey);
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
  const post = async (method: string, payload: object, tokens: number) => {
    const settle = await quota.reserve(tokens, signal);
    try {
      signal.throwIfAborted();
      const response = await fetcher(`${base}:${method}`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After');
          const delay =
            retry && /^\d+(\.\d+)?$/.test(retry)
              ? Number(retry) * 1000
              : retry
                ? Date.parse(retry) - Date.now()
                : 60000;
          quota.cooldown(
            Number.isFinite(delay) ? Math.max(60000, delay) : 60000,
          );
        }
        throw new Error(
          `Google ${method} request failed (${response.status}). Check API key, model access, and quota.`,
        );
      }
      const data = await response.json();
      settle(
        method === 'countTokens'
          ? 0
          : (data.usageMetadata?.totalTokenCount ?? tokens),
      );
      return data;
    } catch (error) {
      settle();
      throw error;
    }
  };
  const count = await post(
    'countTokens',
    {
      generateContentRequest: { ...body, model: `models/${model}` },
    },
    0,
  );
  if (!Number.isSafeInteger(count.totalTokens) || count.totalTokens < 0)
    throw new Error(
      'Google returned no valid token count; request was not sent.',
    );
  const requested = body.generationConfig?.maxOutputTokens;
  if (
    requested !== undefined &&
    (!Number.isSafeInteger(requested) || Number(requested) <= 0)
  )
    throw new Error('Output token limit must be a positive integer.');
  const maxOutputTokens = Math.min(
    typeof requested === 'number' ? requested : 2048,
    2048,
  );
  return post(
    'generateContent',
    {
      ...body,
      generationConfig: { ...body.generationConfig, maxOutputTokens },
    },
    count.totalTokens + maxOutputTokens,
  );
}
