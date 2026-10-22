# Performance and reliability report

## Reproducible measurements

Measured on the development Windows machine on 2026-10-22. The baseline is the prior production build in this checkout; all API responses in automated measurements are synthetic.

| Metric                                             | Before                      | After                     |
| -------------------------------------------------- | --------------------------- | ------------------------- |
| REST requests per normal generation                | 2: countTokens + generation | 1: generation             |
| Local command / screenshot / recording model calls | Task-dependent cloud flow   | 0                         |
| Renderer emitted asset bytes                       | 970,811                     | 349,479                   |
| Renderer asset reduction                           | —                           | 64.0%                     |
| Local routing over 100,000 representative inputs   | Not measured                | Mean 0.00134 ms per input |
| P95 of routing batch means                         | Not measured                | 0.00162 ms per input      |
| Browser render-to-ready smoke test                 | Not measured                | 402 ms in one local run   |
| Browser runtime errors across tested interactions  | —                           | 0                         |

The browser startup measurement is not Electron startup time and excludes network/model latency. The classifier number measures text matching/classification only, not speech recognition or device action latency. P95 is over batch means, not a per-utterance percentile.

Scripts: `pnpm profile:assistant` and `pnpm test:assistant-ui`. Results are saved as JSON alongside screenshots under `test-results/assistant`, or `ASSISTANT_SMOKE_OUTPUT_DIR`.

Native Electron validation also passed: hidden startup to ready in 2866 ms; right-edge bounds, 460/820 px expand/restore, native desktop-operator module loading, local health handling, and cancellation IPC verified with zero reported runtime errors. A single startup snapshot summed process working sets to 663,428 KB. Shared pages can be counted more than once; this is not unique RSS or a before/after memory comparison.

## Pipeline audit and changes

| Bottleneck/failure                                | Implemented change                                                    | Effect                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| countTokens before each generation                | Local conservative estimation + usage reconciliation                  | Removes one serial round trip and half the normal REST calls         |
| Connection test generated “OK”                    | Local validation only                                                 | Saves RPM and avoids extra startup/validation traffic                |
| All REST models shared one bucket                 | Per-model queues and counters                                         | Uses available capacity independently                                |
| Unconditional one-second GUI loop sleep           | Scheduler paces dispatch only when needed                             | A slow model response does not incur an extra fixed second afterward |
| All interactions used screenshot agent            | Separate text conversation route                                      | Routine questions do not capture screens or invoke a GUI loop        |
| Cloud microphone before intent recognition        | Offline Windows speech + local matching                               | Local controls never need microphone cloud round trips               |
| Repeated screenshot decoding/resizing             | Native metadata, direct target capture, two-entry preprocessing cache | Avoids redundant image work                                          |
| Many historical screenshots/context turns         | Current image and bounded text/action windows                         | Smaller requests and bounded memory                                  |
| 5 model retries and action retries                | Bounded alternate-model failover; no action replay                    | Avoids multi-minute retry stalls and duplicate side effects          |
| 250 ms repeated identical progress updates        | Deduplicate status text                                               | Less renderer work during queue waits                                |
| Every streamed token causes heavy render          | 60 ms batching, plain text while streaming                            | Less reconciliation/Markdown parsing                                 |
| Hidden main window + extra task widget            | Persistent single panel                                               | Stop/status remain reachable                                         |
| Developer extensions/browser discovery on startup | Remove extension startup; defer browser/model work                    | Less startup work and loaded code                                    |
| Full recording retained in memory                 | Incremental disk chunks with backpressure                             | Bounded video memory                                                 |
| Late async results revive cancelled UI            | Abort registry + request epoch guards                                 | Stops stale completion and stuck loading                             |

## What the limits mean

The app enforces a local guard of 30 RPM / 16k TPM independently for each model. One request can start immediately; the next waits only if spacing, budget, or cooldown requires it. There is no 30-call preflight tax. At the RPM ceiling the theoretical allowance is 30 generations per model per minute, subject to token budget, response time, and Google's actual quota. This is not a measured throughput claim.

Input/media token estimates are conservative heuristics with output reservations, then reconciled against actual usage. They cannot guarantee exact server TPM accounting. The scheduler correctly handles server 429 responses, and only fails over once before output. Project quotas may also limit both models together or include per-day limits.

Google documents quotas as project-level and model-dependent: [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). Hosted model capabilities are documented in [Gemma on the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api).

## Verification

- 142 focused regression/integration tests passed (17 files).
- Main and renderer TypeScript checks passed.
- Production Electron main/preload/renderer bundles built.
- Browser smoke: local command bypass, streaming, partial-response cancellation, microphone control states, settings, screenshot analysis selection, recording chunk persistence, track release, audio review, window-control wiring, and 360/460/820 px layouts.
- Windows System.Speech helper compiled successfully; one installed recognizer detected. The check did not activate the microphone.

## Dependency cleanup

Removed seven unused direct dependencies after searching retained renderer/main sources:

- `@emotion/react`, `@emotion/styled`
- `formik`
- `react-countdown`, `react-countup`
- `electron-debug`, `electron-devtools-installer`

The lockfile importers were updated without upgrading other packages. Frozen offline lockfile validation passed. Unreferenced snapshots can remain in the lockfile until a future full pruning pass; removing a direct dependency does not imply every shared transitive dependency disappeared.

Retained deliberately: React/Markdown/icons for the new panel, SDK/action parser and native/browser operators, Sharp/native permission modules used elsewhere, and compatibility components still referenced by source/type checks. OpenAI/Jimp dependencies remain in shared upstream SDK code; the app's Google transport does not make OpenAI calls.

Recommended next cleanup: retire unreachable legacy pages/voice UI and remote operator adapters, then prune their Radix/form libraries and ws dependencies; split the Google transport from the legacy SDK to remove unused provider code; deduplicate native permission packages after cross-platform tests. These removals need package/installer checks rather than deleting dependencies still referenced by retained source.

## Measurements still required before rollout

Real Google time-to-first-token and quota behavior; actual screenshot latency at 1080p/4K and multiple DPI settings; microphone recognition accuracy and barge-in with speakers; screen recording on all target OSes; native desktop cancellation under slow applications; long-session Electron RSS/CPU; signed installer startup and permissions.

Existing automated tests demonstrate architecture and state behavior. They do not substitute for these device and provider measurements.
