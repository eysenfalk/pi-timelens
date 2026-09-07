# Repository setup checklist

This file records maintainer-only settings that cannot be enforced from source. Create the repository privately and complete every available launch control. When making it public, immediately enable and verify the public-only private-reporting control before announcement or npm publication.

## GitHub

- Repository: `eysenfalk/pi-timelens`
- Description: `Every turn. Every tool. Every token. Local timing and token observability for Pi.`
- Homepage: `https://www.npmjs.com/package/pi-timelens`
- Topics: `pi-package`, `pi-coding-agent`, `developer-tools`, `observability`, `timing`, `telemetry`, `tokens`, `ttft`, `terminal`, `typescript`
- Default branch: `main`
- Enable Issues, Discussions, private vulnerability reporting, Dependabot alerts, Dependabot security updates, secret scanning, and automatic deletion of merged branches.
- Immediately after changing visibility to public, verify private vulnerability reporting as the documented confidential security and conduct channel before announcement or npm publication.
- Disable Wiki unless it gains a distinct purpose; versioned documentation belongs in the repository.
- Use `media/gallery.webp` as the social preview.

Protect `main` with a ruleset that:

- requires pull requests for non-maintainer changes;
- requires the Node 22, Node 24, and CodeQL checks;
- requires conversations to be resolved;
- blocks force pushes and branch deletion;
- permits maintainers to ship urgent security fixes without weakening audit history.

Create an `npm` deployment environment with maintainer approval before release jobs can run. Keep stable npm publication disabled until every release-control item is complete.

## npm

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

## Pi gallery

The `pi-package` keyword and `pi.image` manifest field make the package eligible for `https://pi.dev/packages`. After npm publication, verify the gallery card, image, description, install source, and repository link at desktop and narrow widths.
