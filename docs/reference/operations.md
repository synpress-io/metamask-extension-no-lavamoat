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
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

## Planned Dry-Run Commands

```bash
node dist/cli/check-for-upstream-release.js --dry-run --tag v13.25.0
node dist/cli/build-release.js --dry-run --tag v13.25.0
```

These dry runs must not publish artifacts and must print a machine-readable build plan.
