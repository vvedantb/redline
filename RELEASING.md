# Releasing

Only `@vvedantb/redline` is published. Releases use Changesets and npm Trusted Publishing (OIDC only, no npm token).

## Steps

1. For every user-facing change, run `npm run changeset`. Pick `@vvedantb/redline`, choose the bump, and write a short note. Commit the file in `.changeset/` with the change.
2. When changes reach `main`, the Release workflow opens or updates a **Version Packages** PR. It bumps the version and updates `packages/redline/CHANGELOG.md`.
3. Merge that PR. The workflow then publishes to npm with provenance (OIDC, no token), creates the tag `vX.Y.Z`, and creates the GitHub release from the changelog.

## Dry run

Run the Release workflow from the Actions tab with `dry_run` set to true. It builds, runs `changeset status`, and runs `npm publish --dry-run --tag dryrun -w @vvedantb/redline`. Before that step, it sets the package version to the throwaway version `0.0.0-dryrun.0` in the runner only, so the check passes when the current version is already on npm. The `--tag dryrun` flag is required because npm refuses to publish a prerelease version without an explicit `--tag`. The dry run commits nothing and does not publish.

## Setup notes

- Configure a Trusted Publisher for `@vvedantb/redline` on npmjs.com (repository `vvedantb/redline`, workflow `release.yml`).
- Publishing uses npm Trusted Publishing (OIDC) only. The release job sets no `registry-url` in `actions/setup-node`, so no auth config is written to `.npmrc`. The workflow needs `id-token: write` and npm 11.5.1 or later.
- The repository setting "Allow GitHub Actions to create and approve pull requests" must be on.
- History: git tags exist for v0.3.0 to v0.6.0. GitHub Releases exist only for v0.3.0 and v0.4.0 (latest release: v0.4.0). npm latest is 0.6.0. So v0.5.0, v0.5.1 and v0.6.0 are tagged and on npm but have no GitHub Release. The release script does not backfill them.
