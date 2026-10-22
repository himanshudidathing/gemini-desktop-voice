# Gemini Desktop

A local-first desktop assistant built on [ByteDance UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop). Chat, voice, screenshots, recording, and desktop actions live in one dark panel docked to the right side of the screen.

- **Local controls first:** stop, cancel, pause, health checks, screenshots, recording, settings, microphone, minimize, clear chat, and time queries bypass AI.
- **Offline Windows voice:** Windows speech recognition receives the microphone before command matching. Say “Gemini” before a model task; local controls work without a wake name. Replies use the installed Windows voice.
- **Automatic routing:** Gemma 4 26B for ordinary conversation; Gemma 4 31B for screen understanding, desktop actions, and complex technical work.
- **Independent model scheduling:** 30 RPM / 16,000 estimated-and-reconciled TPM per model. One generation request, no token-count or connection-test preflights.
- **Streaming and cancellation:** visible progress, partial responses, Stop controls, cancellation of queued work, and bounded failover before any response has streamed.
- **Local media:** PNG screenshots and WebM screen recordings saved to your Pictures/Videos folders. Recording never invokes a model.

## Start

Follow [SETUP.md](SETUP.md). Copy [.env.example](.env.example) to `.env`, add a Google AI Studio key, and run:

```powershell
npx --yes pnpm@9.10.0 install --filter "ui-tars-desktop..." --frozen-lockfile
npx --yes pnpm@9.10.0 --filter "ui-tars-desktop^..." run build
npx --yes pnpm@9.10.0 dev:ui-tars
```

Local controls work without an API key. Offline voice requires Windows with an installed speech language pack. Chat and screen tools also run on the other platforms supported by Electron; their native behavior needs platform-specific validation. Audio-file uploads are an explicit cloud transcription operation and enter the composer for review.

## Design and verification

- [Architecture and voice-command flow](docs/ARCHITECTURE.md)
- [Performance measurements and dependency audit](docs/PERFORMANCE.md)
- [Implementation roadmap and release gates](docs/ROADMAP.md)
- [Configuration and migration notes](docs/gemini.md)

```powershell
npx --yes pnpm@9.10.0 test:gemini
npx --yes pnpm@9.10.0 --filter ui-tars-desktop typecheck
npx --yes pnpm@9.10.0 --filter ui-tars-desktop build:dist
npx --yes pnpm@9.10.0 test:assistant-ui
npx --yes pnpm@9.10.0 profile:assistant
```

The UI test uses a mocked Electron/API bridge and a synthetic video stream. It does not activate your microphone, capture your desktop, or call Google. Native voice accuracy, OS permissions, real desktop actions, and Google model access require device testing before a production rollout.

## Attribution

Apache-2.0. ByteDance notices, licenses, and shared packages are retained. The original introduction is preserved in [docs/upstream-README.md](docs/upstream-README.md). Google is the only cloud provider used by this desktop application; historical shared packages remain for compatibility.
