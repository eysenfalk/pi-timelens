# Contributing

Thank you for helping make Pi TimeLens more accurate, legible, and trustworthy.

## Before coding

- Search existing issues.
- Open a focused issue for behavior changes or new metrics.
- Keep privacy, measurement semantics, compatibility, and narrow-terminal rendering explicit.
- Do not add analytics, remote services, model calls, or fabricated provider values.

Small documentation and test corrections can go directly to a pull request.

## Setup

```bash
git clone https://github.com/eysenfalk/pi-timelens.git
cd pi-timelens
npm ci
npm run check
npm run smoke:packed
```

Node.js 22 or newer is required. The development dependency pins the Pi version used for package smoke tests. Before changing user-visible terminal output or gallery media, follow [Development, TUI validation, and gallery workflow](docs/development-workflow.md).

## Engineering standards

- Keep Pi-specific lifecycle code in `runtime.ts` or `index.ts`.
- Put deterministic measurement, normalization, formatting, and reporting logic in pure modules.
- Use monotonic readings for elapsed time and wall readings only for displayed timestamps.
- Preserve missing provider fields as unavailable.
- Keep exports allowlist-based and content-free.
- Add a focused regression test for every bug fix.
- Keep output English-only and verify compact rendering at narrow widths.

## Pull requests

A good pull request includes:

- the problem and intended invariant;
- the smallest root-cause change;
- tests for success, failure, cancellation, and lifecycle edges when relevant;
- `npm run check` output;
- `npm run smoke:packed` output for package/runtime changes;
- screenshots or terminal captures for user-visible rendering changes;
- compatibility and privacy impact.

Use clear, imperative commit subjects. Conventional Commit prefixes such as `fix:`, `feat:`, `docs:`, and `chore:` are encouraged for readable release notes.

Maintainers control versioning, tags, releases, and npm publication. Pull requests must not add credentials or bypass release gates.
