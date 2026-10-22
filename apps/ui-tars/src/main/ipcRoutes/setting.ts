import { googleGenerateContent } from '@ui-tars/sdk/core';
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
      if (
        !input.apiKey ||
        !/^(gemini-[a-zA-Z0-9._-]+|gemma-4-(31b|26b-a4b)-it)$/.test(
          input.modelName,
        )
      )
        throw new Error(
          'Enter a Google API key and Gemini or Gemma 4 model ID.',
        );
      const data = await googleGenerateContent({
        model: input.modelName,
        apiKey: input.apiKey,
        body: {
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: {
            maxOutputTokens: 2048,
            ...(input.modelName.startsWith('gemma-4-')
              ? { thinkingConfig: { thinkingLevel: 'minimal' } }
              : {}),
          },
        },
      });
      return Boolean(
        data.candidates?.[0]?.content?.parts?.some(
          (part: { text?: string }) => part.text,
        ),
      );
    }),
});
