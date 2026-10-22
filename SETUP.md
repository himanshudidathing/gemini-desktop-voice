# Setup and launch

## Requirements

- Node.js 20 or newer, Git, and a Google AI Studio key with access to `gemma-4-26b-a4b-it` and `gemma-4-31b-it`.
- Windows with an installed speech language pack for offline voice. Local speech does not require an API key. The sidebar reports an error if the recognizer or microphone is unavailable; it does not silently switch to cloud listening.
- Chrome if you choose browser automation.
- Screen-capture/accessibility permissions where your OS requires them.
- Native operator prerequisites in [CONTRIBUTING.md](CONTRIBUTING.md). On Windows, compilation may require Python and Visual Studio Build Tools with Desktop development with C++.

Google controls availability and project quotas. Check [your active limits in AI Studio](https://aistudio.google.com/rate-limit). Local scheduling does not increase those limits or coordinate other applications using your project.

## Install

```powershell
git clone https://github.com/himanshudidathing/gemini-desktop-voice.git
cd gemini-desktop-voice
Copy-Item .env.example .env
notepad .env
```

Enter your key after `GEMINI_API_KEY=`. The repository is private, so GitHub authentication with repository access is required.

```powershell
npx --yes pnpm@9.10.0 install --filter "ui-tars-desktop..." --frozen-lockfile
npx --yes pnpm@9.10.0 --filter "ui-tars-desktop^..." run build
npx --yes pnpm@9.10.0 dev:ui-tars
```

If a previous install used `--ignore-scripts`, run `npx --yes pnpm@9.10.0 rebuild --pending` before launching. The Electron executable and native dependencies must be installed; building JavaScript bundles alone is insufficient.

The same package commands work on macOS/Linux. Use `cp .env.example .env` there. Offline microphone recognition currently requires Windows; typed controls and the rest of the sidebar remain available.

The panel appears on the right. Open its gear icon to set the API key, assistant name, and Computer/Chrome operator. Saving settings performs local validation and sends no test generation. Keep the development terminal open; Ctrl+C stops development.

## Everyday use

| Input                                                                     | Behavior                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stop / Cancel / Abort                                                     | Abort requests, queued generations, capture/analysis, uploads, and recording; interrupt spoken output |
| Pause                                                                     | Cancel the current operation and retain the conversation; no automatic resume                         |
| Can you hear me? / Are you listening?                                     | Immediate local status and, when voice is enabled, local spoken reply                                 |
| Take screenshot                                                           | Capture and save a PNG; show preview; no model call                                                   |
| Start / Stop screen recording                                             | Local screen-only WebM recording; no microphone audio and no model call                               |
| Open settings / Toggle microphone / Minimize sidebar / Clear conversation | Local control                                                                                         |
| What time is it?                                                          | Local system time                                                                                     |
| Ordinary question                                                         | Gemma 4 26B, streamed into the conversation                                                           |
| Analyze this screenshot / complex technical request                       | Prefer Gemma 4 31B                                                                                    |
| Open Chrome / explicit Desktop task mode                                  | Screenshot-and-action loop, preferring Gemma 4 31B                                                    |

Use Auto for local routing. Conversation mode avoids desktop action dispatch. Analyze screen captures the current primary display or uses the screenshot you selected in Captures. Desktop task mode explicitly enables computer/browser actions.

The panel's square button always stops active work. Escape does the same while the panel has keyboard focus. Minimize uses the OS window manager; restore from the taskbar or tray. Expand toggles panel width. Close stops work and microphone listening, then hides the panel; restore it from the tray. The panel remains available during desktop tasks. Minimize it if it covers an application control you need to use.

## Voice

1. Click **Enable microphone**.
2. On Windows, permit microphone access and ensure a speech language pack is installed.
3. Say **“Gemini, open Chrome”**, or say **“Gemini”** followed by the task within 12 seconds.
4. Say **“Stop”** to cancel; the wake name is not required for local controls.
5. Click the microphone again to stop listening. This alone does not cancel an active task.

Speech recognition and spoken replies use Windows on-device speech. The microphone is not streamed to Google Live. Assistant-name changes take effect after turning the microphone off and on. Recognition accuracy depends on your installed language, microphone, noise, and speaker feedback. UI Stop remains available independently.

An audio-file upload is different: clicking the paperclip sends the selected file to `gemini-3.8-flash` for transcription. WAV, MP3, M4A, AAC, FLAC, OGG, and WebM up to 10 MB are supported, subject to the local token budget. The transcript enters the composer for review. Sending it then passes through local intent matching; it never executes automatically.

## Captures and recordings

- Screenshots: **Pictures / Gemini Desktop**, PNG.
- Recordings: **Videos / Gemini Desktop**, WebM.
- Captures tab: preview, reveal the saved file, or explicitly send a screenshot for analysis.
- Recordings use one-second chunks, disk backpressure, a ten-minute duration limit, and a 512 MB limit. Stop saves the captured portion. Interrupted writes are reported.
- OS permission dialogs may appear on first use; subsequent local dispatch adds no network round trip.

The gallery covers the current app session. Saved files remain on disk after clearing chat or restarting. Conversation text is retained locally, bounded to 60 displayed messages; images/video bytes are not written to chat history.

## Models and limits

The sidebar selects `gemma-4-26b-a4b-it` for lightweight requests and `gemma-4-31b-it` for screen/complex work. No model performs routing or command classification.

Each model gets a process-local 30-request / 16,000-token rolling-minute guard. The first request starts immediately. Requests arriving less than one second apart wait for the remainder of that second; RPM/TPM exhaustion can require a longer wait. Both models can be used without sharing one local quota bucket.

There is no `countTokens` preflight. Conservative local prompt/media estimates plus output reservations are reconciled with Google's usage metadata. Estimates are not exact tokenization, so server quota errors remain possible. A single request too large for the budget is rejected promptly.

The scheduler can choose the alternate model when its queue is shorter and fail over once on transient 429/5xx failures before any answer is emitted. It never retries after a partial stream or repeats an executed desktop action. Authentication/access errors require correction, not retries. The chosen model and failover are visible in the panel.

Normal requests have a three-minute deadline, uploads two minutes, captures 20 seconds, desktop workflows ten minutes. Cancel is available during all waits. Local counters reset on restart and do not cover other keys/processes in the same Google project.

## Configuration compatibility

`GEMINI_API_KEY` and `GEMINI_ASSISTANT_NAME` configure the sidebar. Nonempty environment variables override saved settings at startup. Existing environment priority remains: process environment, working-directory `.env`, app-directory `.env`, repository `.env`.

`GEMINI_MODEL`, `GEMINI_LIVE_MODEL`, and `GEMINI_VOICE` remain accepted for legacy presets/SDK consumers. The redesigned sidebar's two-model router and local Windows voice take precedence over those legacy mode selections.

## Verify

```powershell
npx --yes pnpm@9.10.0 test:gemini
npx --yes pnpm@9.10.0 --filter ui-tars-desktop typecheck
npx --yes pnpm@9.10.0 --filter ui-tars-desktop build:dist
npx --yes pnpm@9.10.0 test:assistant-ui
npx --yes pnpm@9.10.0 profile:assistant
# Optional, after Electron/native installation:
npx --yes pnpm@9.10.0 test:assistant-native
```

Set `CHROME_PATH` if Chrome is not in its standard Windows location. Test artifacts default to `test-results/assistant`; set `ASSISTANT_SMOKE_OUTPUT_DIR` to override. UI checks use mocked IPC/API and synthetic recording content. They do not test live Google requests or real desktop permissions.

If Electron downloads fail with a certificate error on a managed network, configure your organization's trusted CA certificates for Node. Keep TLS verification enabled. For missing native modules, complete installation/rebuild scripts and restart. For a voice initialization error, check Windows microphone access and installed speech languages.

See [architecture](docs/ARCHITECTURE.md), [measurements](docs/PERFORMANCE.md), and [release gates](docs/ROADMAP.md).

The native smoke test starts the app hidden using `GEMINI_START_HIDDEN=1`, checks native operator loading, real IPC, and window bounds, then closes it. It does not enable the microphone, capture the desktop, or call Google.
