# Repository setup checklist

Repository controls that cannot be enforced from source are recorded here for auditability.

## GitHub — verified 2026-09-07

- [x] Public repository: `eysenfalk/pi-timelens`.
- [x] Description and topics configured for Pi, timing, observability, tokens, TTFT, terminal, and TypeScript discovery.
- [x] Issues and Discussions enabled; Wiki disabled; merged branches deleted automatically.
- [x] Private vulnerability reporting enabled and documented as the confidential security and conduct channel.
- [x] Dependabot alerts and security updates enabled.
- [x] Secret scanning and push protection enabled.
- [x] Default workflow-token permission reduced to read-only.
- [x] CI passed on Node 22 and Node 24; CodeQL passed after public activation.
- [x] `main` requires current CI plus CodeQL checks, resolved conversations, one code-owner review for non-maintainer changes, linear history, and no force push or deletion. Maintainers retain an audited emergency bypass.
- [x] `npm` deployment environment created with maintainer approval.
- [ ] Upload `media/gallery.webp` as the social preview through GitHub's repository settings; no supported API exposes this control.
- [ ] Set the repository homepage to the npm package after stable publication.

## npm — explicitly deferred

No npm registry mutation was authorized during the GitHub launch.

1. Require 2FA on the maintainer account.
2. Publish only the reviewed `1.0.0-rc.0` artifact interactively with the `next` tag as the documented trust bootstrap; it cannot carry GitHub provenance.
3. Immediately configure Trusted Publishing:
   - provider: GitHub Actions;
   - owner: `eysenfalk`;
   - repository: `pi-timelens`;
   - workflow: `release.yml`;
   - environment: `npm`;
   - permission: publish.
4. Verify the trust relationship before creating the stable release.
5. Publish `1.0.0` only through the protected OIDC workflow and verify its provenance.
6. Keep the bootstrap prerelease limitation documented and never use an interactive exception for stable releases.

## Pi gallery — deferred with npm

The `pi-package` keyword and `pi.image` manifest field make the package eligible for `https://pi.dev/packages`. After npm publication, verify the gallery card, image, description, install source, and repository link at desktop and narrow widths.
