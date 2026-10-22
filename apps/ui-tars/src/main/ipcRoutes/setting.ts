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
        !input.apiKey?.trim() ||
        !/^(gemini-[a-zA-Z0-9._-]+|gemma-4-(31b|26b-a4b)-it)$/.test(
          input.modelName,
        )
      )
        throw new Error('Enter a Google API key and supported model ID.');
      // Local configuration validation only. Model access is checked by the first real request.
      return true;
    }),
});
