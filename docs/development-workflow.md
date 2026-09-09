# Development, TUI validation, and gallery workflow

This maintainer guide records how Pi TimeLens is developed, tested inside real Pi terminals, and turned into faithful repository media. It is intentionally separate from the [runtime architecture](architecture.md): this document describes the evidence pipeline, not extension internals.

## Evidence pipeline

Every user-visible change moves through the same sequence:

```text
isolated branch
  → focused deterministic tests
  → complete repository checks
  → exact npm artifact smoke
  → real Pi at 120 and 40 columns
  → sanitized transcript evidence
  → accessible SVG redraws
  → WebP gallery assets
  → champion comparison and independent review
  → deliberate merge, install, or release
```

Compilation is not acceptance. A passing unit test cannot prove Pi loading, interactive lifecycle, real terminal wrapping, package contents, coexistence with other extensions, or gallery fidelity.

## 1. Work in isolation

Start from a clean, current `main` branch and create a feature branch or worktree. Keep the active Pi installation unchanged until the candidate has passed review.

```bash
git status --short --branch
git switch -c <feature-branch> origin/main
npm ci --ignore-scripts
```

The supported baseline is declared in `package.json`: Node.js 22 or newer, with Pi and Pi TUI pinned as development dependencies for reproducible local checks. Do not read or copy ambient Pi credentials, settings, sessions, or unrelated context into a candidate fixture.

Before implementation, write observable invariants. For timing work these normally include:

- one timing owner and no duplicate registrations;
- provider-reported usage only;
- correct source order and aggregate scope;
- compact subscription-label omission with truthful metered cost and expanded billing scope;
- complete success, failure, retry, cancellation, and settled-state behavior;
- every rendered line fitting the width passed to Pi's `render(width)` contract;
- no intended runtime network, subprocess, model-context injection, or install hook in the runtime package.

## 2. Use focused tests during implementation

Run the smallest relevant file while editing:

```bash
node --experimental-strip-types --test tests/core.test.ts
node --experimental-strip-types --test tests/reporting.test.ts
node --experimental-strip-types --test tests/commands.test.ts
node --experimental-strip-types --test tests/index.test.ts
```

The tests use deterministic clocks and synthetic provider messages. They cover formatting and aggregation without waiting on wall time or calling a model. Width-sensitive tests must calculate ANSI-stripped visible width and assert every output line stays within the supplied terminal width.

Format and check the complete repository before runtime work:

```bash
npm run format
npm run check
npm run smoke:packed
npm run benchmark
```

`npm run check` executes Biome, strict TypeScript, the complete test suite, Markdown/media checks, workflow-contract checks, and npm package inspection. The exact test count belongs in the evaluation evidence for a reviewed commit, not as a permanent promise in this guide.

## 3. Treat the npm artifact as the product

`scripts/check-package.mjs` runs `npm pack --dry-run --json --ignore-scripts` and verifies:

- package identity, license, gallery metadata, and the Pi entrypoint;
- no install lifecycle hooks;
- absence of direct `fetch(`, `WebSocket`, `node:child_process`, and `sendMessage(` references in the six runtime source files;
- no runtime dependencies;
- an unpacked-size budget below 500 KB;
- required runtime, documentation, and media files;
- exclusion of tests, scripts, CI files, candidate plans, `.env*`, coverage, and `node_modules` by path pattern.

These are narrow executable package invariants, not an exhaustive security or secret scan. Review the complete tarball inventory and search intended public source, README, docs, and SVGs for private paths, session identifiers, credential-shaped strings, and unrelated content before merge. Inspect every match manually; never read secret stores merely to compare against them.

`scripts/smoke-packed-pi.mjs` then packs the repository, extracts that exact tarball, registers it in a temporary Pi home, starts the installed Pi 0.85.1 CLI in offline RPC mode, verifies `get_state`, and confirms that `/timing` is registered exactly once. The child receives an allowlisted environment and no credentials, sessions, skills, prompts, context files, or provider call. The whole temporary tree is removed in `finally`.

Direct extraction is sufficient here because the package contract forbids runtime dependencies. If runtime dependencies are ever introduced, change the smoke first: install the `.tgz` into a clean staging root with `npm install --omit=dev --ignore-scripts --prefix <staging> <archive.tgz>`, verify the production dependency closure, and point Pi at the staged package root.

## 4. Build a public-safe real-Pi fixture

Real TUI validation uses a disposable directory rather than this repository or a user session. A minimal parallel-tool fixture is enough:

```text
<fixture>/
├── auth.ts      # export const authenticated = true;
└── config.ts    # export const mode = "strict";
```

Representative prompt:

```text
Use the read tool to read auth.ts and config.ts in one parallel tool batch, then reply with exactly: Verified both files.
```

This forces the batch path while keeping the capture harmless and understandable. Choose a model available to the maintainer, record its identifier and reasoning level in private test evidence, and obtain approval before a provider call with meaningful cost. Do not commit provider credentials, session IDs, raw user prompts, or local home paths.

## 5. Run a real 120-column Pi session

The accepted wide check used a fresh PTY, the source entrypoint as the only extension, no user skills/prompts/context, no persisted session, and Pi's raw TUI logger:

```text
bash tool
  command: rows=35; cols=120; stty rows "$rows" cols "$cols"; \
    test "$(stty size)" = "$rows $cols"; \
    exec env PI_TUI_WRITE_LOG=<repo>/.artifacts/timelens-120.ansi \
    pi --no-extensions --extension <repo>/extensions/pi-timelens/index.ts \
    --no-skills --no-prompt-templates --no-themes --no-context-files \
    --no-session --model <provider/model:thinking> "<representative prompt>"
  cwd: <fixture>
  pty: true
  background: true
  ptyCols: 120
  ptyRows: 35
```

`ptyCols` and `ptyRows` are Pi coding-harness tool settings, not Pi CLI options. `stty size` verifies the real PTY dimensions before Pi starts. Merely setting `COLUMNS=120` is not equivalent.

Inspect the active screen with a one-shot PTY status read, wait for the final settled transcript, then exit cleanly with Ctrl+D. Use a bounded wait or terminate the process if it stalls; never leave a model or TUI process unattended.

Assert the actual behavior, not only visual resemblance:

- Pi reports one TimeLens extension;
- both reads belong to one Step in source order;
- compact output does not repeat member timing rows already represented by Pi's native tool cards;
- assistant and model-backed-tool usage appears once at Step scope;
- `response` is distinct from strict text `ttft`, tool-only turns omit `ttft`, and `think` appears only from observed/reported reasoning evidence;
- provider-reported reasoning tokens remain a subset of output/total and are not added again;
- compact Steps and Totals contain no `sub` or `subscription` label, while expanded records retain billing scope;
- the final Total is settled and no live status remains;
- unrelated startup or renderer errors are absent;
- every visible line fits 120 columns;
- shutdown completes and temporary state is removed.

## 6. Repeat at a real 40 columns

Use a new log file and a tall narrow PTY:

```text
rows=60; cols=40
ptyCols: 40
ptyRows: 60
PI_TUI_WRITE_LOG=<repo>/.artifacts/timelens-40.ansi
```

Keep the fixture, prompt, entrypoint, and assertions otherwise identical. Verify that wrapping preserves complete semantic units: no detached duration, token, price, status, or tool label may be stranded on its own because a desktop line was sliced mechanically.

After isolated checks pass, install the reviewed package exactly as users will and rerun both widths in a fresh full-profile Pi process. This catches duplicate registration and interactions with footer or status extensions that an isolated test cannot expose. Because the active Pi process does not reload changed extension code automatically, use a fresh process or `/reload` after installation.

## 7. Turn raw ANSI into reviewable evidence

`PI_TUI_WRITE_LOG` records Pi's raw ANSI terminal writes. This repository ignores both `.artifacts/` and `*.ansi`; raw logs remain temporary because they can contain startup notices, paths, transient frames, or provider details.

The accepted captures used a manual, inspectable extraction rather than an undocumented parser:

1. Wait until Pi's final timing record is settled.
2. Read the PTY emulator's current `screen` view and retain that final visible frame as private test evidence.
3. Exit Pi cleanly, then inspect the corresponding raw ANSI log around its final writes to confirm that the screen view did not omit a later state.
4. Copy only the representative prompt/tool/result and TimeLens-owned settled lines into a width-specific text fixture.
5. Remove startup help, transient working frames, update notices, footer, model identifier, filesystem paths, and assistant reasoning content exactly as declared in the fixture header. Do not perform any other rewriting.
6. Compare fixture text, order, values, and line breaks against the retained final screen line by line. Record manual review; no automated ANSI replay or text extractor was used for the current assets.

For each accepted width, preserve the resulting sanitized fixture:

- [`tests/fixtures/real-pi-120.txt`](../tests/fixtures/real-pi-120.txt)
- [`tests/fixtures/real-pi-40.txt`](../tests/fixtures/real-pi-40.txt)

Each fixture records the Pi version, terminal width, capture date, journey, and declared omissions. The current fixtures omit startup help, transient working UI, update notices, footer, model identifiers, filesystem paths, and assistant reasoning content. They preserve TimeLens text, order, values, success state, and wrapping exactly.

Sanitization may remove irrelevant private context, but it must never make the extension appear faster, cheaper, more correct, or more attractive. Search the candidate fixture and SVG source for user names, home paths, unrelated repositories, secrets, keys, and session IDs before committing. Never inspect secret stores merely to perform this search.

## 8. Build faithful SVG redraws

The original showcase artwork was replaced after comparison with the real TUI showed a fidelity gap. The current sources are accessible, reviewable transcript redraws derived from the sanitized fixtures:

- [`media/demo.svg`](../media/demo.svg) — 960 × 410, 120-column composition;
- [`media/demo-mobile.svg`](../media/demo-mobile.svg) — 440 × 620, 40-column composition.

The SVGs were manually authored from those fixtures: each visible transcript line was copied into an SVG `<text>` element at the matching wide or narrow line break, then color, hierarchy, and spacing were applied from the observed Pi theme. The result was read back as source, rendered, and compared side by side with both the fixture and retained final screen. The SVGs include `<title>`, `<desc>`, and provenance `<metadata>` and visibly label themselves as faithful Pi transcript redraws. They are not called screenshots because the crop is reconstructed rather than a pixel dump.

The current `check-docs` script verifies provenance markers, fixture and asset existence, README integration, and rejection of known stale strings. It does **not** prove line-for-line SVG fidelity; that remains an explicit manual review gate whenever capture text or media changes.

Do not shrink the wide SVG for mobile. The narrow asset is a separate composition based on the 40-column capture; this keeps the text readable at GitHub's mobile display size.

## 9. Render and inspect gallery assets

The accepted WebP files were originally rendered from the SVG sources with FFmpeg 8.0.1 and libwebp. A later clean regeneration with FFmpeg 7.1.5 reproduced both files byte-for-byte; that is recorded evidence for those environments, not a guarantee across every renderer/font stack:

```bash
ffmpeg -loglevel error -y -i media/demo.svg \
  -c:v libwebp -lossless 1 -q:v 90 media/gallery.webp
ffmpeg -loglevel error -y -i media/demo-mobile.svg \
  -c:v libwebp -lossless 1 -q:v 90 media/gallery-mobile.webp
```

Record the renderer and font environment when reproducing the images. SVG-to-WebP bytes are not renderer-independent. If FFmpeg is unavailable, use an already-approved local SVG/WebP toolchain; do not install one silently.

Open both rendered images at native size and at the size GitHub will display. Inspect legibility, crop, line spacing, contrast, source parity, and mobile composition. The README uses responsive `<picture>` markup so the narrow WebP is selected below 600 px.

`scripts/check-docs.mjs` guards the media contract: local Markdown links resolve, all four source/rendered assets exist, SVG provenance names real Pi 0.85.1 sessions and the correct widths, stale illustrative strings cannot return, response/thinking metrics remain present, and both sanitized capture fixtures exist. `scripts/check-package.mjs` separately proves that intended media enters the tarball while raw captures and test fixtures do not.

## 10. Compare, review, and promote deliberately

Before merge, record the candidate against the unchanged released implementation using the same synthetic fixture:

- correctness and regressions;
- provider-usage and billing truthfulness;
- wide/narrow behavior;
- npm artifact inventory;
- lifecycle and full-profile coexistence;
- benchmark overhead and its limits;
- code and documentation complexity;
- rollback.

`npm run benchmark` measures 20,000 synthetic complete cycles after warm-up and enforces a deliberately loose 500 µs budget. It excludes provider latency, terminal painting, filesystem export, startup, and command-report generation. Treat a local number as regression evidence, not universal marketing performance.

Request independent read-only review only after the diff and evidence are stable. Address findings, rerun affected focused checks, then rerun the complete gate. Merge, public push, local Pi installation, npm publication, tags, and release settings are separate decisions; none follows automatically from green tests.

After an authorized merge or install, verify the exact merged commit in a fresh Pi process. The post-merge TimeLens check loaded one Git-installed resource, retained footer integration, and passed the same real 120/40-column batch journey. Keep the previous installation source and settings checkpoint as the rollback path.

## Completion checklist

- [ ] Clean feature branch or worktree from current `main`.
- [ ] Observable invariants and unchanged champion recorded.
- [ ] Focused tests pass for changed behavior and lifecycle edges.
- [ ] `npm run format`, `npm run check`, `npm run smoke:packed`, and `npm run benchmark` pass.
- [ ] Package inventory contains only intended public runtime/docs/media files.
- [ ] Real isolated Pi runs pass at verified 120 and 40 columns.
- [ ] Fresh full-profile runs pass after installing the reviewed artifact.
- [ ] Raw ANSI logs remain ignored; sanitized fixtures declare omissions.
- [ ] Desktop and mobile SVG/WebP pairs are faithful and visually inspected.
- [ ] Candidate is compared with the unchanged release.
- [ ] Independent findings are resolved and evidence is synchronized.
- [ ] Promotion, publication, installation, and release authority are explicit.
- [ ] Final commit, versions, checks, residual risks, and rollback are recorded.
