# Google configuration and migration

The sidebar now uses a local-first pipeline. It automatically routes between `gemma-4-26b-a4b-it` and `gemma-4-31b-it` over Google's native API. A separate `gemini-3.8-flash` route handles explicitly uploaded audio files.

Live microphone recognition and response speech use Windows on-device speech. The former continuous Google Live microphone path is not registered by the new app entry point. This makes it possible to handle commands before sending any model request. Legacy Live classes/tests and settings remain in the source tree for compatibility, but are not the sidebar's voice engine.

Use [SETUP.md](../SETUP.md) for current settings, voice controls, model quotas, and installation. Existing API keys and assistant names migrate through the same settings store; environment overrides still apply. The legacy task-model field does not override the new capability router.

No connection-check generation or countTokens call is sent. Model access is discovered by actual work. API errors are sanitized, and API keys remain out of application logs and committed examples.

See [ARCHITECTURE.md](ARCHITECTURE.md) for routing/cancellation and [PERFORMANCE.md](PERFORMANCE.md) for verified results and limitations.
