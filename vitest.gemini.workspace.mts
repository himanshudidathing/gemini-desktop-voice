/** Focused desktop/model regressions without loading unrelated monorepo projects. */
export default [
  {
    test: {
      name: 'gemini-regression',
      include: [
        'packages/ui-tars/sdk/src/*.test.ts',
        'apps/ui-tars/src/main/shared/*.test.ts',
        'apps/ui-tars/src/main/environment.test.ts',
        'apps/ui-tars/src/main/services/geminiLive.test.ts',
        'apps/ui-tars/src/main/services/audioTranscription.test.ts',
        'apps/ui-tars/src/main/services/operations.test.ts',
        'apps/ui-tars/src/main/agent/operator.test.ts',
        'apps/ui-tars/src/main/services/assistant.test.ts',
        'apps/ui-tars/src/main/services/localMedia.test.ts',
        'apps/ui-tars/src/renderer/src/components/Voice/*.test.ts',
        'apps/ui-tars/src/main/store/types.test.ts',
      ],
    },
  },
];
