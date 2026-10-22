# Desktop Assistant

A focused desktop assistant based on ByteDance's UI-TARS Desktop: Google voice, Groq and Google reasoning, local screen tools, and a permanent right-side panel.

- **Google voice:** continuous microphone transcription through Google's Live transcription API. Responses from either provider are spoken by Google TTS. Playback can be interrupted immediately.
- **Local controls:** Stop, Cancel, Pause, settings, screenshots, recording, microphone, and chat controls are matched before any reasoning model call.
- **Provider modes:** `MODEL=GOOGLE`, `GROQ`, or `BOTH`. Hybrid prefers Groq and automatically falls back to Google when capacity or availability requires it.
- **Screen understanding:** Groq's `qwen/qwen3.8-27b` returns validated UI elements and bounding boxes. Automation uses the center of an identified target, with confidence and coordinate checks.
- **Google reasoning:** Gemma 4 26B for simple requests, Gemma 4 31B for complex/screen tasks.
- **Refined workspace:** quiet dark styling, live voice activity, streaming chat, inline errors, local captures, and provider settings.

## Start

Follow [SETUP.md](SETUP.md). Copy [.env.example](.env.example), add your keys, install dependencies, build workspace packages, and run `pnpm dev:ui-tars`.

Google credentials remain necessary for voice even when Groq is the only reasoning provider. The app makes no promise of free or unlimited provider usage; availability and quotas are controlled by your accounts.

## Design and verification

[Architecture](docs/ARCHITECTURE.md) · [Performance and verification](docs/PERFORMANCE.md) · [Roadmap and release gates](docs/ROADMAP.md)

Provider tests and browser/native smoke tests cover routing, cancellation, voice playback, local tools, and panel behavior. Live model quality, real microphone/acoustic behavior, and device permissions require validation on the deployment hardware.

Original project: [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop). Upstream licensing and attribution remain in this repository.
