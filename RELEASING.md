# Releasing

Releases are maintainer-only and follow Semantic Versioning.

## Prepare

1. Update `CHANGELOG.md` and `package.json` in a reviewed pull request.
2. Run `npm ci --ignore-scripts`, `npm run check`, `npm run smoke:packed`, and the real Pi TUI release journey.
3. Inspect `npm pack --dry-run --json` and the resulting tarball.
4. Confirm the version is not already present on npm.
5. Obtain independent correctness/security and documentation/release review.

## Stable releases

1. Merge the release commit to `main`.
2. Create and publish the matching GitHub release tag, exactly `vX.Y.Z`.
3. The `Publish npm release` workflow verifies the tag, repeats all checks, smoke-tests the packed package, and publishes through npm Trusted Publishing with provenance.
4. Verify the npm provenance badge and install from a clean temporary Pi home with `pi install npm:pi-timelens@X.Y.Z`.
5. Verify the Pi package gallery entry and GitHub release assets.

The GitHub `npm` environment must require maintainer approval. Configure npm Trusted Publishing for repository `eysenfalk/pi-timelens`, workflow `release.yml`, and environment `npm`; do not store a long-lived npm token.

## One-time trusted-publisher bootstrap

npm requires a package to exist before a Trusted Publisher can be attached. Use one explicit exception for `1.0.0-rc.0`; stable releases must never use it.

1. Complete repository controls, make the repository public, enable private vulnerability reporting, and verify the protected `npm` environment.
2. Inspect the reviewed `1.0.0-rc.0` tarball again.
3. Publish that prerelease interactively with account 2FA and the `next` tag: `npm publish --access public --tag next`. This bootstrap prerelease will not carry GitHub provenance; document that limitation.
4. Immediately configure the Trusted Publisher through npm's website or `npm trust github pi-timelens --file release.yml --repo eysenfalk/pi-timelens --env npm --allow-publish` using npm 11.15.0 or newer.
5. Verify the relationship with `npm trust list pi-timelens`.
6. Prepare reviewed `1.0.0`, then publish it through the normal GitHub release workflow. Verify provenance before announcing the stable release.

No token or OTP belongs in repository files, shell arguments, logs, or session transcripts.

## Rollback

npm versions are immutable. If a release is defective:

1. mark the GitHub release clearly;
2. deprecate the affected npm version with a migration message;
3. publish a fixed patch version through the normal workflow;
4. never rewrite tags or reuse a version.
