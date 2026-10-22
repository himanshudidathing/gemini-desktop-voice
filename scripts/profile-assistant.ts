import { performance } from 'node:perf_hooks';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  localIntent,
  classifyRequest,
} from '../apps/ui-tars/src/main/shared/assistant';
import {
  estimateGoogleTokens,
  googleGenerateContent,
} from '../packages/ui-tars/sdk/src/googleQuota';
async function main() {
  const inputs = [
    'stop',
    'Can you hear me?',
    'take screenshot',
    'Hello',
    'What is a compiler?',
    'Analyze this screenshot',
    'Explain this codebase',
    'Open Chrome',
  ];
  for (let i = 0; i < 10000; i++) {
    const text = inputs[i % inputs.length];
    localIntent(text) || classifyRequest(text);
  }
  const samples: number[] = [];
  for (let pass = 0; pass < 20; pass++) {
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      const text = inputs[i % inputs.length];
      localIntent(text) || classifyRequest(text);
    }
    samples.push((performance.now() - start) / 5000);
  }
  samples.sort((a, b) => a - b);
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Explain what is on this screen.' },
          { inlineData: { mimeType: 'image/jpeg', data: 'placeholder' } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 2048 },
  };
  let requests = 0;
  const start = performance.now();
  await googleGenerateContent({
    model: 'gemma-4-31b-it',
    apiKey: 'profile-only',
    body,
    fetcher: (async () => {
      requests++;
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Mock result' }] },
          },
        ],
        usageMetadata: { totalTokenCount: 200 },
      });
    }) as typeof fetch,
  });
  const assets = path.resolve('apps/ui-tars/dist/renderer/assets');
  const result = {
    measuredAt: new Date().toISOString(),
    mode: 'local synthetic; no Google calls',
    classifierSamples: 100000,
    classifierMeanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    classifierP95BatchMeanMs: samples[18],
    networkCallsPerGeneration: requests,
    mockTransportMs: performance.now() - start,
    screenshotRequestEstimatedTokens: estimateGoogleTokens(body),
    rendererAssetsBytes: readdirSync(assets).reduce(
      (n, f) => n + statSync(path.join(assets, f)).size,
      0,
    ),
    previousRendererAssetsBytes: 970811,
    notes: [
      'This harness does not measure real API, speech, capture, or Electron startup/RSS. See the separate native-checks report.',
      'Token estimates are conservative heuristics, not exact tokenizer counts.',
      'Baseline assets measured from previous production build in the same checkout.',
    ],
  };
  const folder =
    process.env.ASSISTANT_SMOKE_OUTPUT_DIR || 'test-results/assistant';
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, 'performance.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
