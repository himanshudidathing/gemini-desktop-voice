import {
  estimateGoogleTokens,
  getGoogleRestQuota,
  googleGenerateContent,
  GoogleRequestError,
  type GoogleRequest,
} from './googleQuota';

export const FAST_MODEL = 'gemma-4-26b-a4b-it';
export const DEEP_MODEL = 'gemma-4-31b-it';
export type RouteEvent = { model: string; reason: string; failover: boolean };

/** Prefer the appropriate capability; use the alternate only when it avoids a queue or a retryable failure. */
export async function googleRoutedGenerate(
  request: GoogleRequest & { onRoute?: (route: RouteEvent) => void },
) {
  const models =
    request.model === FAST_MODEL
      ? [FAST_MODEL, DEEP_MODEL]
      : request.model === DEEP_MODEL
        ? [DEEP_MODEL, FAST_MODEL]
        : [request.model];
  const tokens =
    estimateGoogleTokens(request.body) +
    Math.min(
      Number(request.body.generationConfig?.maxOutputTokens) || 1024,
      2048,
    );
  const wait = (m: string) =>
    getGoogleRestQuota(request.apiKey, m).snapshot(tokens).waitMs;
  if (
    models.length === 2 &&
    wait(models[0]) > 1000 &&
    wait(models[1]) + 1000 < wait(models[0])
  )
    models.reverse();
  let emitted = false;
  for (let index = 0; index < models.length; index++) {
    request.signal?.throwIfAborted();
    const model = models[index];
    request.onRoute?.({
      model,
      reason: index
        ? 'Transient failure; alternate model'
        : model !== request.model
          ? 'Alternate model has available capacity'
          : 'Local capability routing',
      failover: index > 0,
    });
    try {
      return await googleGenerateContent({
        ...request,
        model,
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
        index === models.length - 1 ||
        !(error instanceof GoogleRequestError) ||
        ![429, 500, 502, 503, 504].includes(error.status)
      )
        throw error;
    }
  }
}
