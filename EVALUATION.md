# Release evaluation — 1.0.0-rc.0

Evaluation date: 2026-09-09. Status: isolated compact billing-label candidate; npm publication was not authorized and has not been performed.

## Compact billing-label candidate

GitHub issue: [#6 — Remove redundant subscription labels from compact timing UI](https://github.com/eysenfalk/pi-timelens/issues/6)

### Decision target

Remove `sub` and `subscription` from compact Step, Total, legacy replay, and default Powerline-footer output without hiding tokens, inventing cost, or erasing billing scope from expanded diagnostics and reports. Subscription cost metadata remains suppressed; metered records still show only provider-reported cost, and mixed records show only their metered subtotal.

### Deterministic gates

- `npm run check`: 58 tests pass on Node 24; TypeScript, Biome, documentation, workflow, package, and source-parity checks pass.
- `npm run smoke:packed`: the exact `pi-timelens-1.0.0-rc.0.tgz` installs offline into a fresh Pi home and registers `/timing` exactly once.
- Package contract: 22 intended files, 165,654 unpacked bytes; tests, raw ANSI logs, temporary fixtures, repository-only evidence, install hooks, and runtime dependencies remain excluded.
- Focused regression coverage proves compact omission for Step, Total, assistant/tool/batch replay, subscription, mixed, metered, and cost-off paths. Expanded records retain explicit billing mode; mixed details label `Metered cost`; JSON/CSV exports retain billing mode while suppressing subscription-only cost metadata.
- The isolated footer companion passes 14 tests. Subscription-backed sessions show neither a label nor informational cost; metered and mixed sessions still show the authoritative TimeLens metered subtotal.

### Real Pi evidence

- Installed Pi: `@earendil-works/pi-coding-agent@0.85.1`.
- Provider-backed checks used `openai-codex/gpt-5.6-luna:low` with two public-safe fixture reads in one parallel batch.
- Isolated real PTYs at 120 and 40 columns showed compact Step/Total records without `sub`, `subscription`, or a fabricated price; `Ctrl+O` retained `Billing: subscription` and the full usage breakdown.
- The 120-column combined TimeLens/Powerline run loaded both candidates, produced exactly one Step per turn plus one Total, and rendered a one-line footer with tokens but no subscription label or informational dollar amount. A fresh 40-column combined startup rendered a bounded two-line footer with the same omission.
- A deterministic real-Pi state emitter then exercised genuine schema-V1 `Billing: mixed` telemetry: the footer rendered only `$0.125` at both 120 and 40 columns, with no subscription label or subscription informational cost.
- Fresh RPC loaded the two candidates together, returned state successfully, and registered exactly one `/timing`, `/powerline`, and `/powerline-profile` command.
- Sanitized fixtures and faithful SVG/WebP redraws were refreshed from raw captures `154d43a…97b` (120 columns) and `bdde6b1…d8` (40 columns); raw ANSI remains ignored under `.artifacts/hide-subscription/`.

### Champion comparison and rollback boundary

The unchanged TimeLens champion is merged/deployed commit `c5a4848cff52b498166a7df81431d99982724ec3`: 56 tests pass and its same-host benchmark measured 4.735 µs/cycle. The candidate adds two regression tests and measured 4.858 µs/cycle (+0.123 µs, about 2.6%), which is measurement-scale overhead and remains far below the 500 µs budget. The candidate changes no timing, usage aggregation, lifecycle, or persistence semantics. It adds one optional schema-V1 `session.billingMode` telemetry field for footer consumers.

The active Powerline champion differs by one runtime expression: it renders `sub` for subscription sessions. The candidate renders nothing for subscription billing and preserves `$…` only for non-subscription reported cost. The champion's current test command reaches eight passing tests before an obsolete test-only import of the retired local timing owner fails; the candidate points that integration test at the current TimeLens source and passes all 14 tests. Runtime loading and real TUI behavior pass independently of that baseline test-path drift. The first independent code review blocked a model-only subscription heuristic that hid mixed metered cost; TimeLens now publishes session billing scope, Powerline treats that telemetry as authoritative, and focused plus real 120/40-column mixed-state regressions pass. The independent code follow-up returned `DEPLOY`. Independent visual review returned `DEPLOY`; its low-severity SVG canvas mismatch was also corrected.

No active-harness file is changed by the candidate. Rollback before promotion is deleting the isolated footer candidate and resetting this branch. After an authorized local deployment, restore checkpoint `pre-pi-timelens-no-subscription-labels-20260909` and the prior TimeLens pin `c5a4848cff52b498166a7df81431d99982724ec3`.

## Step/Total UX baseline (merged and deployed)

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

The Step/Total UX was merged in PR #5 as `c5a4848cff52b498166a7df81431d99982724ec3` and deliberately installed into the active Pi home after review. npm publication remains a separate decision.

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
