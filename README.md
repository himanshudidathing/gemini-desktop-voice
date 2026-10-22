# Gemini Desktop — voice and actions

A Google Gemini and Gemma desktop assistant built on [ByteDance UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop). Give it a task by typing, attaching an audio recording, or saying its name. It uses screenshots to control your local computer or Chrome, then replies using Gemini Live native audio.

## What changed

- Google is the only provider exposed by the desktop app. Desktop actions use Gemma 4 31B by default, or a Gemini vision model, through Google's native `generateContent` API.
- Gemini Live provides streaming microphone input, speech transcription, and native spoken replies.
- Say **“Gemini, open Chrome”**, or say **“Gemini”** and then give the task within 12 seconds. The name and voice are configurable.
- Say **“Gemini, stop”** to cancel a task. A visible Stop task button is also available.
- Upload an audio file up to 10 MB. Its transcription appears in the composer so you can review and send it.
- Results from spoken, typed, and uploaded-audio tasks are spoken while voice mode is enabled.
- The upstream hosted remote operators and provider switcher are absent from this app. Upstream automatic updates are disabled to preserve this fork.

The original monorepo libraries and their licenses remain in the source tree as upstream infrastructure; the desktop runtime is wired exclusively to Google APIs. This is a prompt-driven screenshot/action integration, not Google's separately billed Computer Use tool API.

## Run

Follow [SETUP.md](SETUP.md) for the full setup process, including the [environment template](.env.example), dependency installation, and voice controls.

Use Node.js 20 or newer. Copy `.env.example` to `.env`, add your Google API key, then run from the repository root:

```powershell
npx --yes pnpm@9.10.0 install --filter "ui-tars-desktop..." --frozen-lockfile
npx --yes pnpm@9.10.0 --filter "ui-tars-desktop^..." run build
npx --yes pnpm@9.10.0 dev:ui-tars
```

If dependencies were installed with `--ignore-scripts`, finish native/Electron installation with `npx --yes pnpm@9.10.0 rebuild --pending` before launching. Native operator prerequisites are documented in the upstream contributing guide.

Open **Your computer** or **Your browser**. Enter a [Google AI Studio API key](https://aistudio.google.com/apikey) in Gemini Settings. Defaults:

| Setting          | Default           |
| ---------------- | ----------------- |
| Task model       | `gemma-4-31b-it`  |
| Live voice model | `gemini-3.8-live` |
| Assistant name   | `Gemini`          |
| Speaking voice   | `Aoede`           |

Choose model IDs available to your Google project. Allow microphone access when you enable voice. Desktop screen/accessibility permissions and local Chrome are needed for their respective operators.

## Voice behavior

The microphone starts only after **Enable voice** is clicked. While enabled, audio is streamed to Google for transcription, including speech before the assistant's name. The application checks the transcribed name before dispatching any task; this is cloud-based activation, not an offline wake-word engine. A name-only activation expires after 12 seconds and is consumed by the next task.

The microphone pauses while Gemini's audio plays to prevent feedback. To interrupt playback immediately, use **Stop task** or **Turn voice off**. Spoken stop is available while the microphone is listening.

Turning voice off, leaving the session, or losing the Live connection stops microphone tracks and closes the audio context. The UI reports connection/quota errors and offers reconnection by enabling voice again. It does not silently retry or change models. Turning voice off leaves an already-running task alone; use **Stop task** to cancel execution.

Uploaded recordings are sent only when you select them and become editable text; they do not auto-execute. Task results are based on the desktop execution state, not a verbal promise from the Live model.

## Free-tier access

Check Google AI Studio for model availability, pricing, and free-tier quota for your project. Model access, regional eligibility, and quotas are controlled by Google. This app does not provision billing, buy credits, or bypass limits; an API key attached to a paid project follows that project's billing settings.

- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Google Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Google Live WebSocket protocol](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)

## Checks

```powershell
npx --yes pnpm@9.10.0 test:gemini
npx --yes pnpm@9.10.0 --filter ui-tars-desktop typecheck
npx --yes pnpm@9.10.0 --filter ui-tars-desktop build:dist
```

For the browser smoke test, first build the desktop bundles, then run `npx --yes pnpm@9.10.0 test:voice-ui`. It uses a simulated microphone and a mocked Electron/API bridge, and writes screenshots under `test-results/voice-ui`. Set `CHROME_PATH` when Chrome is installed elsewhere; alternatively install Playwright Chromium. The smoke test makes no Google API calls.

The regression suite covers native Google requests, screenshot coordinates, wake-name gating, delayed transcription, cancellation commands, disconnects, PCM capture/playback, and audio upload validation. Live network/microphone behavior still needs verification with your own API key and audio device.

## Attribution

Based on the Apache-2.0 UI-TARS Desktop project by ByteDance. Upstream notices, licenses, and shared packages are retained. The previous upstream introduction is preserved in [docs/upstream-README.md](docs/upstream-README.md).

Gemma 4 31B is now the default desktop task model (`gemma-4-31b-it`); Gemini remains available for tasks and powers Live voice/audio transcription. REST calls share a process-local 30 RPM / 16,000 TPM budget. See [SETUP.md](SETUP.md#gemma-4-and-rest-rate-limits) for scope, configuration, and verification limits.
