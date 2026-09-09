# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Monotonic Step, model, tool, and full-cycle timing.
- Distinct response-stream latency, strict text TTFT, exact thinking-event windows with a documented provider-reasoning fallback phase, legacy first-output timing, streaming duration, and provider-reported output throughput.
- Provider-reported input, output, reasoning, cache-read, cache-write, and total tokens without double-counting reasoning.
- Provider-reported metered cost without invented estimates; billing scope remains available in expanded details and reports.
- One Step per model turn and its source-ordered tools, with compact wall time and expanded work time.
- Branch-local summary, timeline, legend, settings, and safe JSON/CSV exports.
- Display-only transcript entries and content-free live/session telemetry.
- Responsive semantic wrapping for narrow terminals.
- Schema V3 Step persistence with V1 and V2 replay compatibility.
- A maintainer workflow for exact-package smoke tests, real 120/40-column Pi validation, sanitized capture evidence, and faithful SVG/WebP gallery reproduction.

### Changed

- Compact output now answers user-facing questions with one Step and one Total instead of separate assistant, single-tool, and batch rows.
- Step latency now separates response, optional text TTFT, observed thinking, tools, tokens, and cache instead of presenting the first reasoning/tool delta as TTFT.
- Pi's native tool cards remain the compact source for tool identity and outcome; TimeLens no longer repeats every member of a successful parallel group.
- Step usage combines the assistant call and model-backed tool reports exactly once, with readable token, cache, and provider-reported price fields.
- Exact timestamps, streaming speed, full token categories, individual tools, and cumulative work moved to expanded details.
- Compact Step, Total, and legacy replay output omits redundant `sub`/`subscription` labels; subscription-only records keep tokens without a fabricated cost, while mixed records show only the metered subtotal.
- Expanded timing details, summaries, JSON/CSV exports, and content-free session telemetry retain explicit billing scope.
- Desktop and narrow gallery assets were recaptured from the real Step UX at verified 120- and 40-column PTYs.

### Fixed

- Preserve legacy V1 child usage when an old cycle record has no aggregate, without cross-cycle suppression.
- Omit subscription-only cost fields from direct and nested JSON/CSV exports while retaining reported tokens and explicit billing mode.
- Avoid mislabeling the first reasoning or tool-call delta as time to first text token.

Publication as `1.0.0` remains gated by the repository and release checklist.
