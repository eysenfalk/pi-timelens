# Security policy

## Supported versions

Security fixes are provided for the latest published release. Upgrade with:

```bash
pi update npm:pi-timelens
```

## Reporting a vulnerability

Release and public announcement are blocked until GitHub private vulnerability reporting is enabled. Once this repository becomes public, maintainers enable and verify **Report a vulnerability** in the Security tab before announcing or publishing the package. Do not open a public issue for a suspected vulnerability or include sensitive details in a public message.

Include the affected version, impact, minimal reproduction, and any suggested mitigation. You can expect an acknowledgement within seven days. Disclosure timing will be coordinated after a fix is available.

## Security posture

- No runtime dependencies.
- No network calls, analytics, or model calls.
- No install or post-install scripts.
- Display-only records remain outside model context.
- JSON/CSV exports rebuild records from explicit allowlists.
- Export files are written with mode `0600`.
- CI actions are pinned to full commit SHAs.
- Stable releases are verified from tags and use npm Trusted Publishing with provenance through a protected GitHub environment.
- npm requires the package to exist before trust can be attached, so the one-time `1.0.0-rc.0` bootstrap is an explicitly documented interactive exception without provenance; see [RELEASING.md](RELEASING.md).

Pi extensions execute with the Pi process's local permissions. Review source and provenance before installing any Pi package.
