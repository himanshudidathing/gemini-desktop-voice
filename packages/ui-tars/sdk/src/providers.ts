import {
  GoogleRestQuota,
  estimateGoogleTokens,
  type GoogleRequest,
} from './googleQuota';
import { googleRoutedGenerate } from './googleRouting';
import {
  VISION_INSTRUCTION,
  parseVision,
  visionAction,
  type VisionResult,
} from './vision';
export type ProviderMode = 'GOOGLE' | 'GROQ' | 'BOTH';
export type ProviderSettings = {
  mode: ProviderMode;
  groqApiKey: string;
  groqModel: string;
};
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
export const groqQuotas = new Map<string, GoogleRestQuota>();
export function getGroqQuota(key: string) {
  if (!groqQuotas.has(key)) groqQuotas.set(key, new GoogleRestQuota());
  return groqQuotas.get(key)!;
}
export class GroqRequestError extends Error {
  constructor(public status: number) {
    super(
      'Groq request failed (' +
        status +
        '). Check provider access or try again after the cooldown.',
    );
  }
}
type Request = GoogleRequest & {
  providers: ProviderSettings;
  vision?: 'analysis' | 'automation';
  onVision?: (vision: VisionResult) => void;
  onRoute?: (route: {
    model: string;
    reason: string;
    failover: boolean;
  }) => void;
};
function groqMessages(request: Request) {
  const body = request.body as any;
  const messages: any[] = [];
  const system = (body.systemInstruction?.parts || [])
    .map((p: any) => p.text || '')
    .join('\n');
  if (system || request.vision)
    messages.push({
      role: 'system',
      content:
        system +
        (request.vision
          ? '\n' + VISION_INSTRUCTION + '\nMode: ' + request.vision
          : ''),
    });
  for (const c of body.contents) {
    const content = (c.parts || []).map((p: any) => {
      if (typeof p.text === 'string') return { type: 'text', text: p.text };
      if (p.inlineData?.mimeType?.startsWith('image/'))
        return {
          type: 'image_url',
          image_url: {
            url:
              'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data,
          },
        };
      throw new Error('This Groq route supports text and screenshots only.');
    });
    messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content });
  }
  return messages;
}
export async function groqGenerate(request: Request): Promise<any> {
  const { providers, signal = AbortSignal.timeout(180000) } = request;
  if (!providers.groqApiKey.trim())
    throw new Error('Add a Groq API key in Settings.');
  if (!/^[a-zA-Z0-9._/-]{1,120}$/.test(providers.groqModel))
    throw new Error('Invalid Groq model ID.');
  const quota = getGroqQuota(providers.groqApiKey);
  const output = request.vision
    ? 2048
    : Math.min(
        Number(request.body.generationConfig?.maxOutputTokens) || 1024,
        2048,
      );
  const reserved = estimateGoogleTokens(request.body) + output;
  const settle = await quota.reserve(reserved, signal, request.onWait);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    const stream = !!request.onText && !request.vision;
    const response = await (request.fetcher || fetch)(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: 'Bearer ' + providers.groqApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: providers.groqModel,
          messages: groqMessages(request),
          max_completion_tokens: output,
          temperature: 0.3,
          reasoning_effort: 'none',
          stream,
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          ...(request.vision
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const ms = retry
        ? /^\d+(\.\d+)?$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : 60000;
      if ([401, 403, 404, 429, 500, 502, 503, 504].includes(response.status))
        quota.cooldown(Number.isFinite(ms) ? Math.max(1000, ms) : 60000);
      await response.body?.cancel();
      throw new GroqRequestError(response.status);
    }
    let text = '',
      finish = '',
      usage = reserved;
    if (!stream) {
      const data = await response.json();
      text = data.choices?.[0]?.message?.content || '';
      finish = data.choices?.[0]?.finish_reason;
      usage = data.usage?.total_tokens ?? reserved;
    } else {
      if (!response.body) throw new Error('Groq returned an empty stream.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const event = (block: string) => {
        const raw = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!raw || raw === '[DONE]') return;
        const data = JSON.parse(raw);
        if (data.error)
          throw new GroqRequestError(Number(data.error.code) || 500);
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          request.onText?.(delta);
        }
        finish = data.choices?.[0]?.finish_reason || finish;
        usage =
          data.usage?.total_tokens ?? data.x_groq?.usage?.total_tokens ?? usage;
      };
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        buffer += decoder.decode(next.value, { stream: !next.done });
        if (buffer.length > 1024 * 1024)
          throw new Error('Groq stream exceeded the event size limit.');
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          event(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
        if (next.done) break;
      }
      if (buffer.trim()) event(buffer);
    }
    signal.throwIfAborted();
    settle(usage);
    if (finish !== 'stop' || !text.trim())
      throw new Error(
        'Groq response was incomplete. Partial text is retained.',
      );
    if (request.vision) {
      const vision = parseVision(text);
      text =
        request.vision === 'automation' ? visionAction(vision) : vision.summary;
      request.onVision?.(vision);
      request.onText?.(text);
    }
    return {
      candidates: [
        { finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } },
      ],
      usageMetadata: { totalTokenCount: usage },
    };
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    settle();
  }
}
export async function generateWithProviders(request: Request) {
  const { providers } = request;
  if (!['GOOGLE', 'GROQ', 'BOTH'].includes(providers.mode))
    throw new Error('MODEL must be GOOGLE, GROQ, or BOTH.');
  const allowGoogle = providers.mode !== 'GROQ';
  const budget =
    estimateGoogleTokens(request.body) +
    (request.vision
      ? 2048
      : Math.min(
          Number(request.body.generationConfig?.maxOutputTokens) || 1024,
          2048,
        ));
  const groqReady =
    !!providers.groqApiKey &&
    getGroqQuota(providers.groqApiKey).snapshot(budget).waitMs <= 1000;
  let fallback = false,
    emitted = false;
  if (
    providers.mode === 'GROQ' ||
    (providers.mode === 'BOTH' && (groqReady || !request.apiKey))
  ) {
    request.onRoute?.({
      model: providers.groqModel,
      reason: request.vision ? 'Groq visual understanding' : 'Groq priority',
      failover: false,
    });
    try {
      return await groqGenerate({
        ...request,
        onText: request.onText
          ? (text) => {
              emitted = true;
              request.onText!(text);
            }
          : undefined,
      });
    } catch (error) {
      if (
        request.signal?.aborted ||
        emitted ||
        !allowGoogle ||
        !request.apiKey ||
        !(
          error instanceof TypeError ||
          (error instanceof GroqRequestError &&
            [401, 403, 404, 429, 500, 502, 503, 504].includes(error.status))
        )
      )
        throw error;
      if (error instanceof TypeError)
        getGroqQuota(providers.groqApiKey).cooldown(15000);
      fallback = true;
    }
  } else if (providers.mode === 'BOTH') fallback = true;
  if (!allowGoogle) throw new Error('Groq is unavailable.');
  return googleRoutedGenerate({
    ...request,
    onRoute: (r) =>
      request.onRoute?.({
        ...r,
        failover: fallback || r.failover,
        reason: fallback
          ? 'Google fallback · Groq unavailable or at capacity'
          : r.reason,
      }),
  });
}
