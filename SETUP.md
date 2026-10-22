# Setup process

This repository runs **Gemini Desktop**, a Google Gemini-only desktop assistant with native Live voice and local computer/browser actions.

## 1. Prerequisites

- Windows, macOS, or Linux with Node.js **20 or newer** and Git installed.
- A [Google AI Studio API key](https://aistudio.google.com/apikey) with access to your chosen Gemini and Gemini Live models.
- Chrome for browser automation.
- Operating-system permission to use the microphone; screen recording/accessibility permission for desktop automation where required.
- Native desktop operator prerequisites from the upstream [contributing guide](CONTRIBUTING.md). On Windows, native compilation may require Visual Studio Build Tools with Desktop development with C++ and Python.

Google's [free tier](https://ai.google.dev/gemini-api/docs/pricing) has model, account, region, and quota limits. The app does not enable billing or purchase credits. Keys belonging to paid projects follow their project billing settings.

## 2. Clone

```powershell
git clone https://github.com/himanshudidathing/gemini-desktop-voice.git
cd gemini-desktop-voice
```

The repository is private, so clone using a GitHub account with access.

## 3. Configure the environment

In PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

On macOS/Linux:

```bash
cp .env.example .env
# Edit .env with your preferred editor.
```

Enter your own key after `GEMINI_API_KEY=`. Keep `.env` on your computer; it is ignored by Git. The committed `.env.example` contains no API key.

| Variable                | Purpose                                                        | Default                                           |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| `GEMINI_API_KEY`        | Google AI Studio API key                                       | Empty; must be supplied in `.env` or app Settings |
| `GEMINI_MODEL`          | Gemini or Gemma 4 vision model for desktop tasks               | `gemma-4-31b-it`                                  |
| `GEMINI_LIVE_MODEL`     | Gemini Live model for streaming voice                          | `gemini-3.8-live`                                 |
| `GEMINI_ASSISTANT_NAME` | Name to say before a spoken command; 2–32 characters           | `Gemini`                                          |
| `GEMINI_VOICE`          | Speaking voice: `Aoede`, `Kore`, `Puck`, `Charon`, or `Fenrir` | `Aoede`                                           |

Use model IDs available to your Google project. No Hugging Face key, OpenAI key, service-account JSON, or hosted-service signing key is needed.

Loading priority is: existing process environment, `.env` in the working directory, `apps/ui-tars/.env`, then the repository-root `.env`. The normal development command runs from `apps/ui-tars`, and the loader also reads the root template you copied. Non-empty environment variables override saved settings each time the app starts. Leave a variable blank if you want to manage it in the app instead.

## 4. Install dependencies

From the repository root:

```powershell
npx --yes pnpm@9.10.0 install --filter "ui-tars-desktop..." --frozen-lockfile
```

This uses the project's pinned package-manager version. Allow Electron and native dependencies to complete their installation scripts.

If you previously installed using `--ignore-scripts`, finish that setup before launching:

```powershell
npx --yes pnpm@9.10.0 rebuild --pending
```

## 5. Build workspace packages and launch

```powershell
npx --yes pnpm@9.10.0 --filter "ui-tars-desktop^..." run build
npx --yes pnpm@9.10.0 dev:ui-tars
```

Select **Your computer** or **Your browser**. Check Gemini Settings, save, and enter a session. You can also supply an API key and model settings in this dialog if you left them blank in `.env`.

## 6. Use voice or an audio recording

1. Click **Enable voice** and allow microphone access.
2. Say **“Gemini, open Chrome”**, substituting the configured assistant name.
3. Alternatively say the name alone, then give a task within 12 seconds.
4. Hear the task result in Gemini's voice after execution.
5. Say **“Gemini, stop”** while listening, or use **Stop task** to cancel immediately.
6. Use **Turn voice off** to stop the microphone. This leaves any running task alone.

Audio is streamed to Google while voice is enabled, including speech before the activation name. Activation is checked against Google's transcription; it is not an offline wake-word engine. The microphone pauses during spoken playback to avoid feedback, so use the on-screen stop button to interrupt playback.

Click **Add audio** to choose a WAV, MP3, M4A, AAC, FLAC, OGG, or WebM file up to 10 MB. The transcription appears as editable text in the composer. Review and send it; uploads do not auto-execute. Results from typed or uploaded-audio tasks are also spoken while voice is enabled.

## 7. Verify your setup

```powershell
npx --yes pnpm@9.10.0 test:gemini
npx --yes pnpm@9.10.0 --filter ui-tars-desktop typecheck
npx --yes pnpm@9.10.0 --filter ui-tars-desktop build:dist
```

After building the bundles, an optional browser test uses simulated microphone audio and a mocked Electron/API bridge:

```powershell
npx --yes pnpm@9.10.0 test:voice-ui
```

On Windows it uses Chrome's standard installation path. Set `CHROME_PATH` for another location, or install Playwright Chromium on other platforms. Test screenshots are written to the ignored `test-results/voice-ui` directory. The automated tests require no real Google API key.

A manual **Gemini Desktop checks** workflow is available in GitHub Actions. Imported upstream release and benchmark workflows are retained under `.github/upstream-workflows` as reference; they do not run in this repository.

## Troubleshooting

- **401/403 from Google:** check the API key and model access; make sure the key belongs to the intended project.
- **429 or quota failure:** wait for quota recovery or select an eligible model in your Google project. The app does not upgrade billing automatically.
- **Environment changes have no effect:** restart the app; check higher-priority shell or app-directory variables. Non-empty environment values take precedence over saved settings.
- **Microphone unavailable:** check operating-system/browser permission and whether another application owns the device.
- **Voice disconnected:** turn voice off and enable it again to reconnect. A new model/name/voice setting also requires reconnection.
- **Electron or native module missing:** finish install scripts or rebuild pending packages, then rebuild the workspace dependencies.
- **Browser operator unavailable:** install Chrome locally and check the browser settings.

The source was checked with automated tests, type checks, production builds, and simulated browser microphone tests. Live Google calls and real computer actions must still be verified with your own API key and device.

## Gemma 4 and REST rate limits

Set `GEMINI_MODEL=gemma-4-31b-it` in `.env`, restart the app, and use **Check Google connection** in Settings. Existing saved task models remain unless overridden in `.env` or changed in Settings. Gemini vision models and `gemma-4-26b-a4b-it` also remain accepted. Gemma handles screenshots and GUI action text; Gemini Live still handles microphone input and spoken results. Audio-file uploads always use `gemini-3.8-flash`, because Gemma 4 31B does not accept audio.

The app shares a fixed **30 requests per rolling 60 seconds** and **16,000 tokens per rolling 60 seconds** across REST task calls, model checks, and audio uploads using the same API key in this app process. Google `countTokens` preflight calls count toward the request limit too, so there are at most 15 generation calls per minute when each needs a preflight. The token guard counts the full prompt, screenshots/history/audio and reserves up to 2,048 output tokens before generation. Successful usage replaces that reservation; failed requests keep it conservatively. In-flight reservations do not expire, and completed usage stays for another 60 seconds. Long prompts that cannot fit the full output reservation are rejected: start a new task or shorten the recording.

Requests wait for capacity and can be cancelled with **Stop task**. They time out after three minutes. A Google 429 response pauses subsequent requests for at least 60 seconds (or longer when Retry-After says so); failed actions are not automatically retried. These are local safeguards, not changes to Google's account quotas. Other app processes, other API keys in the same Google project, and external API clients are not coordinated. Restarting the app clears local counters. Gemini Live uses separate streaming quotas and is not covered by the REST budget.

Gemma integration is covered by simulated transport/action tests. Real desktop accuracy and model availability still require a manual test with your own Google key.

Google references: [Gemma on the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api), [countTokens](https://ai.google.dev/api/tokens).
