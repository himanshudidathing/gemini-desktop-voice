# Implementation priorities and release gates

## P0 — implemented

- Authoritative local command router ahead of credentials, busy checks, screenshots, and model work.
- Offline Windows microphone recognition with assistant-name activation and local spoken acknowledgements.
- One cancellation registry for generation, queues, analysis/capture, and uploads; recording/speech stop integration.
- Request IDs/epochs preventing late events from reviving cancelled requests.
- Local screenshot/recording tools, previews, status, persisted files, and bounded recording memory.
- Independent 26B/31B budgets, local token tracking, no preflights, capability-aware selection and bounded failover.
- Separate streaming conversation route and explicit screenshot/desktop modes.
- Right-side dark panel with native width/minimize controls, inline settings/errors/progress, and reduced-motion support.
- Context/image caps, screenshot metadata reuse, deferred startup work, and seven direct dependency removals.
- Unit/integration tests, production build, type checks, browser interaction tests, local profiling harness.

## P0 — release validation

Run these gates with the intended Google project and target hardware before distributing a production installer:

1. Confirm both Gemma models and audio transcription access. Measure first-token/total latency, usage reconciliation, and 429/Retry-After behavior.
2. Enable offline voice on a real microphone; test all commands, name-only activation, speaker echo, low confidence, microphone disconnect, and repeated enable/disable.
3. Run desktop actions in a disposable workspace. Cancel before/after capture, during pointer movement, after key down, while queued, and during slow browser navigation. Verify no subsequent action is issued.
4. Record and stop repeatedly; interrupt source permission/setup, test disk failure/low space and the ten-minute/512 MB caps.
5. Verify right-edge bounds, minimize/restore, close/reopen from tray, DPI/monitor changes, and keyboard access on each target OS.
6. Soak for an hour with repeated requests/cancellation/captures; record peak/steady RSS, CPU, handles, and open media tracks.

Native actions already dispatched to an OS cannot be reversed. Verify prevention of later steps and released input state.

## P1 — performance and platform hardening

- Profile actual high-DPI capture/encode stages; move costly image transformations to a worker when measurements justify it.
- Separate Google-only SDK transport from upstream compatibility code; remove unreachable renderer/remote/Live modules after installer regression coverage.
- Persist rate counters or coordinate by project if multiple app processes must share a strict local budget.
- Add macOS/Linux offline speech adapters behind the same text/command contract. Do not reintroduce silent cloud microphone fallback.
- Improve conservative token estimates using model-specific local tokenizer/media metadata when available.
- Collect opt-in local timing diagnostics without message content or credentials.

## P2 — packaging and release quality

- Verify clean installs on supported platforms, sign installers, and create a fork-owned update feed.
- Add native OS integration CI where permissions/devices permit it, plus accessibility checks for the panel.
- Expose measured latency and operational limits in release notes; avoid unverified performance or availability promises.

This roadmap distinguishes implemented functionality from hardware/provider release gates. It does not claim a production certification from mocked tests.
