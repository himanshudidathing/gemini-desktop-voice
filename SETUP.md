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
| `GEMINI_MODEL`          | Native Gemini model for tasks and audio-file transcription     | `gemini-3.8-flash`                                |
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
