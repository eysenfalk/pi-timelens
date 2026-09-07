# Pi TimeLens contributor guide

- Keep the extension local-first, display-only, and outside model context.
- Never estimate provider usage. Missing token or cost fields render as unavailable.
- Measure elapsed time with a monotonic clock; use wall time only for visible timestamps.
- Preserve branch, reload, cancellation, failure, and parallel-tool ordering semantics.
- Keep the Pi adapter thin and put deterministic behavior in tested pure functions.
- Add focused regression coverage for every behavior change.
- Run `npm run check` and the fresh-Pi package smoke test before release.
- Do not publish, tag, or modify release credentials from contributor automation.
