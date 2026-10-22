# Setup and launch

## 1. Requirements

Install Node.js 20 or newer and Git. Chrome is needed only for browser automation. Native desktop control may require the prerequisites in [CONTRIBUTING.md](CONTRIBUTING.md), including Python and Visual Studio C++ Build Tools on Windows.

Create a [Google AI Studio API key](https://aistudio.google.com/apikey) for Google speech and, when enabled, Gemma reasoning. Create a [Groq API key](https://console.groq.com/keys) for Qwen.

Voice uses Google on every OS. No Windows speech language pack is needed.

## 2. Clone and configure

```powershell
git clone https://github.com/himanshudidathing/gemini-desktop-voice.git
cd gemini-desktop-voice
Copy-Item .env.example .env
notepad .env
```

The repository is private; sign into GitHub with an account that can access it. On macOS/Linux use `cp .env.example .env`.

Example configuration:

```dotenv
MODEL=BOTH
GEMINI_API_KEY=your_google_key
GROQ_API_KEY=your_groq_key
GROQ_MODEL=qwen/qwen3.8-27b
GEMINI_ASSISTANT_NAME=Gemini
GEMINI_VOICE=Aoede
GOOGLE_STT_MODEL=gemini-3.5-transcribe-live
GOOGLE_TTS_MODEL=gemini-3.8-flash-lite-tts
```

Never commit your populated `.env`.

| MODEL  | Reasoning and screen requests                                          | Voice  |
| ------ | ---------------------------------------------------------------------- | ------ |
| GOOGLE | Gemma 26B for simple requests; 31B for complex/screen work             | Google |
| GROQ   | Groq Qwen only; no Google reasoning fallback                           | Google |
| BOTH   | Groq first; Google fallback when Groq lacks capacity or is unavailable | Google |

The explicit hybrid provider priority takes precedence over the Google-only complexity rule. In BOTH, simple requests use Groq while available; on Google fallback, simple requests use 26B and complex requests use 31B.

Existing installations without MODEL retain GOOGLE mode. Set MODEL=BOTH to enable the new hybrid path. Missing Groq credentials in BOTH allow Google reasoning; missing Google credentials prevent Google voice and Google fallback.

Google's Live transcription and TTS models must be available to your project. Quotas, billing requirements, and free-tier availability come from your provider accounts. The local 30 RPM guard does not make an API free.

## 3. Install and launch

```powershell
npx --yes pnpm@9.10.0 install --filter "ui-tars-desktop..." --frozen-lockfile
npx --yes pnpm@9.10.0 --filter "ui-tars-desktop^..." run build
npx --yes pnpm@9.10.0 dev:ui-tars
```

If an earlier install used `--ignore-scripts`, run `npx --yes pnpm@9.10.0 rebuild --pending` first. Electron and the native modules must be installed; JavaScript build success alone does not verify native prerequisites.

Keep the terminal open. Ctrl+C stops development. For updates, stop the app, run `git pull --ff-only`, repeat the install/build commands, then restart.

The panel docks to the right. Settings lets you edit provider mode, API keys, Qwen model ID, assistant name, voice, and desktop operator without sending a connection-test request.

Nonempty environment values override saved settings at startup. Environment priority is process environment, working-directory .env, app-directory .env, then repository .env. If a shell or another tool already defines an unrelated MODEL variable, clear it or explicitly set it to GOOGLE, GROQ, or BOTH before launch; process variables take precedence over .env. Restart after editing .env; save and reconnect voice after changing speech settings.

## 4. Use Google voice

1. Add your Google key.
2. Click **Talk to your assistant** / the microphone button.
3. Permit microphone access.
4. Say **“Gemini, what can you help me with?”**, or say **“Gemini”** and give the request within 12 seconds.
5. Speak again to interrupt playback, or say **“Stop”** / **“Cancel”**. Local controls do not need the wake name.

Microphone audio streams to Google's dedicated transcription service. Only the resulting text enters local intent matching. The selected reasoning model generates the answer, and Google TTS speaks it. The speech service does not independently execute commands or invent a separate answer.

The voice meter shows input activity; subtitles show recognized speech. Input remains enabled while speaking, with acoustic echo cancellation. Headphones improve interruption accuracy in noisy rooms. Disable the microphone or close the panel to stop streaming.

A transient established-session disconnect triggers up to three reconnect attempts with backoff. Errors remain visible; there is no offline voice replacement. Text stays usable when speech fails.

Long spoken replies are bounded to 6,000 characters, with code blocks replaced by a brief spoken reference to the visible code. The full model answer stays in chat.

Audio-file upload is separate: the paperclip sends the selected file to Google for transcription, places text in the composer, and waits for you to review/send it.

## 5. Local commands and screen tools

| Command                                                                   | Result                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Stop / Cancel / Abort                                                     | Stop generation, queue waits, capture/analysis, uploads, recording, and playback |
| Pause                                                                     | Cancel current work; keep conversation                                           |
| Can you hear me? / Are you listening?                                     | Local status; Google TTS reads it when voice is enabled                          |
| Take screenshot                                                           | Save locally and show preview; no reasoning call                                 |
| Start / Stop screen recording                                             | Local screen-only WebM recording                                                 |
| Open settings / Toggle microphone / Minimize sidebar / Clear conversation | Local action                                                                     |
| What time is it?                                                          | Local clock                                                                      |

Voice transcription and spoken output still use Google even for local commands. The local action itself bypasses all reasoning models.

Screenshots save under **Pictures / Gemini Desktop**. Recordings save under **Videos / Gemini Desktop**, with a ten-minute/512 MB cap and incremental disk writes. Audio is not included in screen recordings.

Use **Analyze** on a screenshot to send it to the selected provider. With Groq, Captures displays detected bounding boxes and confidence values. Ordinary analysis never clicks anything. Desktop task mode uses validated targets to execute one action, then captures again to verify the next step. Low-confidence or malformed targets stop automation rather than clicking blindly.

The gallery covers the current session; saved files remain on disk. Chat keeps at most 60 local text messages.

## 6. Controls and limits

- Escape and the top Stop button cancel work. The audio player stops locally immediately; cancellation also propagates to the provider.
- Minimize uses the OS window manager. Expand toggles panel width. Close stops work and microphone streaming, then hides the panel. Restore from the tray.
- The sidebar remains visible during desktop tasks. Minimize it if it covers a required target.

Each Google reasoning model has a local 30 RPM / 16k TPM rolling guard. Groq has its own aggregate 30 RPM / 16k TPM guard for chat and vision. The first request starts immediately; closely spaced requests wait only for the remainder of one second unless quota/cooldown requires more time.

There are no countTokens or test-generation requests. Local token estimates reserve output capacity and reconcile actual usage. Provider quotas can differ; local counters are per app process and cannot account for other applications in the same project/organization.

BOTH checks local Groq capacity before dispatch. Rate-limit, network, selected access/unavailability, and transient server failures can fall back to Google before output begins. Future requests try Groq again when its cooldown expires. Partial streams are retained with an error instead of mixing two providers' answers.

Google streaming speech has its own service quotas. Google TTS has a separate local model bucket. Reasoning limits do not override voice quotas.

## Verify

```powershell
npx --yes pnpm@9.10.0 test:gemini
npx --yes pnpm@9.10.0 --filter ui-tars-desktop typecheck
npx --yes pnpm@9.10.0 --filter ui-tars-desktop build:dist
npx --yes pnpm@9.10.0 test:assistant-ui
npx --yes pnpm@9.10.0 test:assistant-native
```

Browser tests use simulated media and mocked API/IPC responses. Native tests load the Electron app and operator, checking window behavior without taking over the desktop. They do not establish live provider quality or real microphone accuracy.

Set CHROME_PATH if Chrome is not installed in its usual location. On managed networks, configure trusted CA certificates for Node if downloads fail; keep TLS verification enabled.

[Architecture](docs/ARCHITECTURE.md) · [Performance](docs/PERFORMANCE.md) · [Release roadmap](docs/ROADMAP.md)
