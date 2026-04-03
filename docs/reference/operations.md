# Operations

## Workflows

- `test.yml`: install, typecheck, build, and test this repository.
- `monitor-releases.yml`: detect the latest official MetaMask release and decide whether a builder release is required.
- `build-release.yml`: build and optionally publish a builder release for a pinned upstream tag.

## Expected Secrets

- `GITHUB_TOKEN` for release inspection and publishing.
- `INFURA_PROJECT_ID` only when the value cannot be extracted from the official release ZIP.

## Local Verification

```bash
corepack enable
corepack pnpm install
corepack pnpm run check:ci
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm test
```

## Planned Dry-Run Commands

```bash
node dist/cli/check-for-upstream-release.js --dry-run --tag v13.25.0
node dist/cli/build-release.js --dry-run --tag v13.25.0
```

These dry runs must not publish artifacts and must print a machine-readable build plan.

## Fixture-Backed No-Network Verification

```bash
node dist/cli/check-for-upstream-release.js \
  --dry-run \
  --tag v13.25.0 \
  --fixture-release test/fixtures/official-release-payloads/github-release.json \
  --builder-release-exists false

node dist/cli/build-release.js \
  --dry-run \
  --tag v13.25.0 \
  --fixture-release test/fixtures/official-release-payloads/github-release.json
```

Use the fixture path when validating local behavior without hitting the GitHub API.
