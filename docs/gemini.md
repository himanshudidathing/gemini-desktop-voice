# Gemini Desktop configuration

The desktop app now supports Google Gemini exclusively. See the root [README](../README.md) for voice behavior and startup instructions.

## Example preset

```yaml
vlmProvider: Google Gemini
vlmBaseUrl: https://generativelanguage.googleapis.com/v1beta/openai/
vlmApiKey: YOUR_GOOGLE_AI_STUDIO_KEY
vlmModelName: gemini-3.8-flash
liveModelName: gemini-3.8-live
assistantName: Gemini
voiceName: Aoede
useResponsesApi: false
operator: Local Computer Operator
language: en
```

The legacy base URL field is retained for storage compatibility. The running app always uses Google's native REST and WebSocket endpoints. Non-Gemini model IDs and provider presets are rejected. Native audio uploads are capped at 10 MB; supported formats include WAV, MP3, M4A, AAC, FLAC, OGG, and WebM.

One voice session can own the microphone at a time. The Live API key is used in the main process's WebSocket; the renderer receives audio/transcription events through specific preload methods. Model-generated transcripts cannot dispatch commands. The activation gate checks only the user's input transcription. Disconnects cancel pending voice dispatch timers and clear activation state.

Changing the assistant name, voice, or Live model takes effect after turning voice off and on. Do not commit real API keys. Previous non-Gemini installations are migrated to Gemini defaults without reusing credentials from another service.

This source build has no configured release feed. It will not download or install upstream UI-TARS updates over the Gemini-only application.
