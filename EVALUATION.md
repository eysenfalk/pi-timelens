# Release evaluation — 1.0.0-rc.0

Evaluation date: 2026-09-07. Status: public GitHub `1.0.0-rc.0` source candidate; npm publication was not authorized and has not been performed.

## Scope and invariants

Pi TimeLens packages the already deployed Message Timing V2 behavior as a standalone Pi package. Timing remains monotonic, provider values remain report-only, custom entries remain display-only, exports remain allowlisted, multi-tool turns remain consolidated, and telemetry remains process-local and content-free.

## Correctness evidence

- `npm run check`: passed on Node 24.20.0; 42/42 tests, strict TypeScript, Biome, docs links, workflow contracts, and npm tarball contract.
- Clean Node 22.20.0 container: `npm ci --ignore-scripts`, full check, and packed-package smoke passed.
- Clean Node 24.20.0 release simulation with exact npm 12.0.2: temporary stable version/tag verification, full check, npm 12 pack parsing, and packed Pi smoke passed. Node 22.20 correctly rejected npm 12.0.2, so the release workflow uses Node 24 while CI smoke still covers Node 22.
- `npm run smoke:packed`: packed `pi-timelens-1.0.0-rc.0.tgz`, extracted the artifact, installed it with Pi's `install` command in a temporary offline home, loaded fresh Pi 0.85.1 RPC, and verified `/timing`.
- Real Pi 0.85.1 TUI at 120 columns: passed one parallel two-tool batch, source ordering, assistant usage, `◆ Total`, and `/timing summary`.
- Real Pi 0.85.1 TUI at 60 columns: exposed and then verified a fixed semantic-wrap defect; TTFT, `tok/s`, token usage, singular `1 step`, and `0 tools` remain complete rather than clipped.
- `npm pack --json --ignore-scripts`: 21 files, 172,355 bytes unpacked, no runtime dependencies or install hooks.
- Independent read-only reviews concluded `RELEASE`, `SHOWCASE-READY`, and visual `READY` after focused re-review of the responsive hero, prerelease truthfulness, npm trust bootstrap, and release-workflow compatibility fixes.
- Public GitHub CI passed both Node 22 and Node 24 jobs at commit `8bb4889`; CodeQL passed after the repository became public. Private vulnerability reporting, secret scanning with push protection, read-only default workflow permissions, protected `main`, and the approval-gated `npm` environment were enabled and verified.

## Cost and performance

The synthetic benchmark creates, settles, and formats 20,000 complete assistant cycles after warmup. Node 24.20.0 on x86_64 AMD EPYC 9634 measured 6.30 microseconds per cycle. This is a microbenchmark, not an end-to-end latency claim. TimeLens makes no network or model calls.

## Complexity

The runtime ships six TypeScript modules and no runtime dependencies. Package, documentation, and workflow checks remain development-only. The npm artifact excludes tests, scripts, GitHub automation, maintainer setup files, and candidate evidence.

## Comparison with the unchanged deployed extension

The package begins from the deployed Message Timing V2 implementation and preserves its entry type, schema, commands, settings file, export location, state events, and lifecycle semantics. Intentional runtime differences are limited to:

- consistent repository formatting;
- type-only clarification of `appendEntry`'s optional return;
- semantic responsive wrapping that never leaves a bare speed number after clipping;
- correct singular/plural labels in cycle and summary output.

The active harness extension has not been replaced or modified by this candidate.

## Rollback

The GitHub repository can be archived if the source launch is withdrawn; the active harness remains unchanged. After npm publication, versions are immutable: deprecate a defective version, publish a patch, and let users pin or reinstall the last known-good version. Never rewrite release tags or reuse versions.

## Remaining external gates

- optional GitHub social-preview upload, which is available only through repository settings;
- separate maintainer approval and authentication for every npm registry mutation;
- documented interactive `1.0.0-rc.0` bootstrap, followed immediately by npm Trusted Publishing configuration and verification;
- reviewed stable `1.0.0` published only through OIDC, with provenance verified;
- clean-registry `pi install npm:pi-timelens@1.0.0` and Pi gallery verification.
