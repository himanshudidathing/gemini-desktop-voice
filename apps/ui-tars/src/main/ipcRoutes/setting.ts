import { initIpc } from '@ui-tars/electron-ipc/main';
import { VLMProviderV2 } from '../store/types';
const t = initIpc.create();
type ModelCheck = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  provider?: VLMProviderV2;
};
export const settingRoute = t.router({
  checkVLMResponseApiSupport: t.procedure
    .input<ModelCheck>()
    .handle(async () => false),
  checkModelAvailability: t.procedure
    .input<ModelCheck>()
    .handle(async ({ input }) => {
      if (!input.apiKey || !/^gemini-[a-zA-Z0-9._-]+$/.test(input.modelName))
        throw new Error('Enter a Google API key and Gemini model ID.');
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelName)}:generateContent`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(60000),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': input.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
            generationConfig: { maxOutputTokens: 8192 },
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Google returned ${response.status}. Check the API key, model availability, and quota.`,
        );
      const data = await response.json();
      return Boolean(
        data.candidates?.[0]?.content?.parts?.some(
          (part: { text?: string }) => part.text,
        ),
      );
    }),
});
