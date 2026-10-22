/** Google-only native generateContent transport for the desktop screenshot loop. */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { UITarsModelVersion } from '@ui-tars/shared/types';
import { UITarsModel, type UITarsModelConfig } from './Model';

export class GeminiModel extends UITarsModel {
  constructor(config: UITarsModelConfig) {
    super({ ...config, provider: 'gemini', useResponsesApi: false });
    if (!/^gemini-[a-zA-Z0-9._-]+$/.test(config.model))
      throw new Error('A Gemini model ID is required.');
  }

  toJSON() {
    return { provider: 'gemini', model: this.modelName };
  }

  protected override async invokeModelProvider(
    _version: UITarsModelVersion,
    params: {
      messages: ChatCompletionMessageParam[];
      previousResponseId?: string;
    },
    options: { signal?: AbortSignal },
    _headers?: Record<string, string>,
  ) {
    const system: { text: string }[] = [];
    const contents: { role: string; parts: object[] }[] = [];
    for (const message of params.messages) {
      if (message.role === 'system' || message.role === 'developer') {
        if (typeof message.content === 'string')
          system.push({ text: message.content });
        continue;
      }
      const parts: object[] = [];
      if (typeof message.content === 'string')
        parts.push({ text: message.content });
      else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item.type === 'text') parts.push({ text: item.text });
          if (item.type === 'image_url') {
            const image = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(
              item.image_url.url,
            );
            if (!image) throw new Error('Screenshot must be an inline image.');
            parts.push({ inlineData: { mimeType: image[1], data: image[2] } });
          }
        }
      }
      if (parts.length)
        contents.push({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts,
        });
    }
    const started = Date.now();
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000);
    const response = await (this.modelConfig.fetch ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.modelConfig.apiKey ?? '',
        },
        body: JSON.stringify({
          ...(system.length ? { systemInstruction: { parts: system } } : {}),
          contents,
          generationConfig: {
            maxOutputTokens: this.modelConfig.max_tokens ?? 8192,
            temperature: 0,
          },
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Gemini request failed (${response.status}). Check your API key, model access, and quota.`,
      );
    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS')
      throw new Error('Gemini output was truncated; no action was executed.');
    if (candidate?.finishReason && candidate.finishReason !== 'STOP')
      throw new Error(
        `Gemini could not complete this request (${candidate.finishReason}).`,
      );
    const prediction = (candidate?.content?.parts ?? [])
      .filter(
        (part: { thought?: boolean; text?: string }) =>
          !part.thought && part.text,
      )
      .map((part: { text: string }) => part.text)
      .join('');
    return {
      prediction,
      costTime: Date.now() - started,
      costTokens: data.usageMetadata?.totalTokenCount ?? 0,
    };
  }
}
