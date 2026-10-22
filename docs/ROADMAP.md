# Implementation and release priorities

## Implemented

- Restore Google voice as the only active sidebar speech path: continuous Google transcription, local text routing, and Google TTS for Gemma/Groq replies.
- Keep microphone input active during playback with acoustic echo cancellation; interrupt playback locally on speech onset, Stop, or Cancel.
- Add bounded reconnect for established Google transcription sessions and reject late audio after cancellation.
- Add MODEL=GOOGLE/GROQ/BOTH, independent credentials, and editable model/voice settings.
- Use Groq Qwen 3.8 27B first in hybrid mode, with local capacity checks, cooldowns, automatic recovery, and Google fallback before output.
- Validate Qwen screenshot metadata and bounding boxes; use detected targets in the native action pipeline.
- Preserve local tools, operation cancellation, token estimation, bounded context, and recording backpressure.
- Refine the panel's spacing, type scale, neutral palette, navigation, onboarding, microphone meter, and screenshot overlays.
- Add protocol, quota, fallback, cancellation, environment, vision, and browser regression coverage.

## P0: deployment validation

1. Add real Google/Groq project keys locally and verify access to the configured transcription, TTS, Gemma, and Qwen models.
2. Measure actual speech-end-to-transcript, first token, TTS-first-audio, screenshot latency, and failover under provider 429/5xx conditions.
3. Test voice with real speakers/headphones, accents/languages, noise, microphone disconnect, and repeated barge-in. Tune local activity thresholds from recordings obtained with consent.
4. Test grounding accuracy on a fixed annotated screen set before relying on automated clicks. Include tiny targets, overlapping windows, multiple DPI settings, and uncertain detections.
5. Validate cancellation, recordings, and panel restore on target OSes and hardware. Run an hour-long repeated-task soak.
6. Validate a clean install and signed packaging before broad distribution.

## P1: measurements-driven hardening

- Stream Google TTS audio if measured time-to-first-audio justifies the extra buffering/protocol work; current TTS uses a bounded WAV response.
- Improve confidence handling using grounding accuracy measurements; model confidence is not calibrated.
- Persist/share quota counters only if multiple app processes must share a strict local budget.
- Move image encoding to a worker if real capture profiling shows UI/main-thread stalls.
- Remove unreferenced legacy offline/Live UI and SDK/provider adapters after packaging tests. Keep ws: the active Google transcription client uses it.

## P2: distribution

- Sign installers, validate upgrades, and configure a fork-owned update feed.
- Broaden native integration CI where device permissions allow.
- Publish measured performance and model availability with releases.

Automated tests verify implementation and state behavior. They do not certify live model accuracy, account access, or microphone performance.
