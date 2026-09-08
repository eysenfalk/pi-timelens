# Release evaluation — 1.0.0-rc.0

Evaluation date: 2026-09-08. Status: isolated Step/Total UX candidate; npm publication was not authorized and has not been performed.

## Step/Total UX candidate

GitHub issue: [#4 — Replace lifecycle-oriented timing rows with user-centered Step/Total summaries](https://github.com/eysenfalk/pi-timelens/issues/4)

### Decision target

Replace the compact Assistant/Tool/Batch hierarchy with one Step per model turn and one cycle Total. A Step combines the model call with the tools it requested, surfaces only actionable defaults, and keeps timestamps, per-tool attribution, throughput, provider/model identifiers, and full usage breakdowns behind Pi's standard `Ctrl+O` expansion.

### Deterministic gates

- `npm run check`: 56 tests pass on Node 24; TypeScript, Biome, documentation, workflow, package, and source-parity checks pass.
- `npm run smoke:packed`: an exact `pi-timelens-1.0.0-rc.0.tgz` installs offline into a fresh Pi home and registers `/timing` exactly once.
- `npm pack --dry-run --json`: 22 intended files, 168,235 unpacked bytes; raw ANSI logs, screenshots, temporary fixtures, tests, and repository-only evaluation files stay out of the package.
- Schema V3 persists Step records while coercing V1 and V2 records for replay, reporting, and safe export.
- Regression coverage exercises model-only, single-tool, parallel-tool, model-backed-tool, mixed-billing, failure, abort, retry recovery, session replay, export, command, and 40-column wrapping paths.

### Real Pi evidence

- Installed Pi: `@earendil-works/pi-coding-agent@0.85.1`.
- Provider-backed checks used `openai-codex/gpt-5.4-mini:low` with two fixture reads in a parallel batch.
- Isolated 120- and 40-column PTY sessions loaded only the candidate and produced two Step records followed by one Total; compact output omitted tool names, call IDs, exact timestamps, wall/work jargon, and unavailable placeholders.
- `Ctrl+O` exposed model timing, first output, streaming, throughput, exact timestamps, per-tool duration/status/call ID, usage categories, provider/model, and stop reason. Expanded 40-column Total timestamps wrap without truncation.
- Fresh 120- and 40-column full-profile sessions loaded the candidate exactly once beside the active extension set and Powerline footer. No duplicate timing entry was emitted.
- Raw `PI_TUI_WRITE_LOG` captures and temporary screenshots remain under ignored `.artifacts/step-ux/`. Sanitized 120-/40-column fixtures preserve observed compact transcript text and values, record raw-capture hashes and omissions, and drive updated faithful-redraw SVG/WebP gallery assets.

### Champion comparison

The unchanged installed champion at `31730d43f82ad3311f76b7d8ed661ff24d029df5` still passes its 51-test suite. Its benchmark measured 4.27 µs/cycle; the candidate measured 4.67 µs/cycle in the same local run (+0.40 µs, about 9%). Both are far below the 500 µs/cycle budget. The candidate adds one persisted Step object per assistant turn but removes separate assistant and tool/batch transcript entries from new sessions, producing materially less visible telemetry and no duplicate compact tool inventory.

### Independent review and current boundary

The first code review blocked on legacy V1 usage suppression and subscription cost leakage in exports. Both root causes received focused regressions; the same reviewer rechecked the fixes and returned `DEPLOY`. Independent visual review found no compact or expanded 120-/40-column UX defect and returned `DEPLOY`; its only stated limit was the absence of a captured error-state screenshot, which remains covered deterministically.

The candidate is isolated on `ux/step-summary`. It has not been installed into the active Pi home, pushed, merged, tagged, or published to npm. Promotion and publication remain separate decisions.

## Original release scope and invariants

Pi TimeLens packages the already deployed Message Timing V2 behavior as a standalone Pi package. Timing remains monotonic, provider values remain report-only, custom entries remain display-only, exports remain allowlisted, multi-tool turns remain consolidated, and telemetry remains process-local and content-free.

## Correctness evidence

- `npm run check`: passed on Node 24.20.0; 51/51 tests, strict TypeScript, Biome, documentation, workflow contracts, and npm tarball contract.
- Clean Node 22.20.0 container: `npm ci --ignore-scripts`, full check, and packed-package smoke passed for the original release candidate; the final source remains covered by Node 22/24 CI on publication.
- Clean Node 24.20.0 release simulation with exact npm 12.0.2: temporary stable version/tag verification, full check, npm 12 pack parsing, and packed Pi smoke passed. Node 22.20 correctly rejected npm 12.0.2, so the release workflow uses Node 24 while CI smoke still covers Node 22.
- `npm run smoke:packed`: final packed `pi-timelens-1.0.0-rc.0.tgz`, extracted the artifact, installed it with Pi's `install` command in a temporary offline home, loaded fresh Pi 0.85.1 RPC, and verified `/timing`.
- Real Pi 0.85.1 TUI at 120 and 40 columns: final source passed parallel two-tool batches, source ordering, responsive wrapping, assistant usage, and `◆ Total` without clipping.
- Provider-usage regressions cover direct aggregate precedence, bounded `details.results[].usage`, nested result ordering, subscription-only batches, mixed subscription/metered batches, metered-only subtotal display, provider-less persisted messages, cycle/report non-duplication, and cost-off summaries.
- `npm pack --json --ignore-scripts`: 21 files, 148,894 bytes unpacked, no runtime dependencies or install hooks.
- The unchanged deployed champion passed 42/42 tests; a deterministic side-by-side shows ordinary batches preserve timing while the candidate removes misleading `tok —` rows and moves model-backed usage to the single batch aggregate. The active harness also passed `npm run validate`.
- Independent final reviews concluded `DEPLOY` for code and visual presentation after mixed-billing, summary-setting, asset-label, mobile-legibility, and capture-evidence fixes.
- Public GitHub CI passed both Node 22 and Node 24 jobs at launch commit `8bb4889`; CodeQL passed after the repository became public. Private vulnerability reporting, secret scanning with push protection, read-only default workflow permissions, protected `main`, and the approval-gated `npm` environment were enabled and verified. The current final candidate has not been pushed.

## Cost and performance

The synthetic benchmark creates, settles, and formats 20,000 complete assistant cycles after warmup. Final Node 24.20.0 execution on x86_64 AMD EPYC 9634 measured 5.36 microseconds per cycle. This is a microbenchmark, not an end-to-end latency claim. TimeLens makes no network or model calls.

## Complexity

The runtime ships six TypeScript modules and no runtime dependencies. Package, documentation, and workflow checks remain development-only. The npm artifact excludes tests, scripts, GitHub automation, maintainer setup files, and candidate evidence.

## Comparison with the unchanged deployed extension

The package begins from the deployed Message Timing V2 implementation and preserves its entry type, schema, commands, settings file, export location, state events, and lifecycle semantics. Intentional candidate differences now include:

- consistent repository formatting and type-only clarification of `appendEntry`'s optional return;
- semantic responsive wrapping that never leaves a bare speed number after clipping;
- correct singular/plural labels in cycle and summary output;
- bounded nested model-tool usage extraction with direct aggregate precedence;
- one truthful token and billing aggregate for each batch, including metered-only subtotals for mixed billing;
- command-level enforcement of the cost-display setting in summaries;
- faithful, visibly labeled 120- and 40-column transcript redraws with sanitized capture fixtures.

The active harness remained unchanged throughout candidate comparison. After PR #2 merged as `31730d43f82ad3311f76b7d8ed661ff24d029df5`, that exact Git source was deliberately installed locally, the previous timing owner was reversibly retired, and fresh full-profile Pi sessions verified one TimeLens resource plus working footer integration at 120 and 40 columns.

## Rollback

The local deployment checkpoint is `pre-pi-timelens-local-git-20260908`; rollback restores the prior package/settings state and re-enables the retired timing owner. The GitHub repository can be archived if the source launch is withdrawn. After npm publication, versions are immutable: deprecate a defective version, publish a patch, and let users pin or reinstall the last known-good version. Never rewrite release tags or reuse versions.

## Remaining external gates

- optional GitHub social-preview upload, which is available only through repository settings;
- separate maintainer approval and authentication for every npm registry mutation;
- documented interactive `1.0.0-rc.0` bootstrap, followed immediately by npm Trusted Publishing configuration and verification;
- reviewed stable `1.0.0` published only through OIDC, with provenance verified;
- clean-registry `pi install npm:pi-timelens@1.0.0` and Pi gallery verification.
