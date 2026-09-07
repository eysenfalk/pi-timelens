## What changed

<!-- Describe the problem, intended invariant, and smallest root-cause change. -->

## Evidence

- [ ] Added or updated focused tests
- [ ] `npm run check`
- [ ] `npm run smoke:packed` when package/runtime behavior changed
- [ ] Tested narrow-terminal output when rendering changed
- [ ] Attached a privacy-safe screenshot or transcript excerpt when user-visible output changed

## Review boundaries

- [ ] Missing provider fields remain unavailable rather than fabricated zeroes
- [ ] Elapsed durations use the monotonic clock
- [ ] Display-only data remains outside model context
- [ ] Exports contain no prompts, assistant text, tool arguments, or tool output
- [ ] Reload, cancellation, failure recovery, and session replacement remain correct

## Compatibility and rollback

<!-- Note schema, command, Pi-version, or integration impact and how users can recover. -->
