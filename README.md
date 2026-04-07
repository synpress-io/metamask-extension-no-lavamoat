# MetaMask Extension No-LavaMoat Builder

This repository builds and publishes prebuilt MetaMask extension artifacts without LavaMoat for Synpress-controlled browser-wallet automation.

## What This Repository Does

- Builds from official `MetaMask/metamask-extension` source tags.
- Produces deterministic Synpress-owned no-LavaMoat artifacts for Chromium/Chrome.
- Publishes provenance alongside each release:
  - built artifact ZIPs
  - `SHA256SUMS.txt`
  - `release-manifest.json`
- Keeps the builder package private. This repository is source-public, not an npm package.

## Intended Use

- Automated testing
- Controlled local development environments
- CI environments that need a pinned browser-wallet artifact

This repository is not for real funds, real wallets, or ordinary browsing. Disabling LavaMoat is an explicit security tradeoff and is only acceptable here because the target use case is automation under controlled conditions.

## Release Model

- Upstream source of truth: official MetaMask GitHub releases and source tags
- Builder release tag format: `vX.Y.Z-no-lava`
- Release automation is driven by GitHub Actions
- `monitor-releases.yml` checks upstream hourly
- `build-release.yml` builds and publishes a pinned upstream tag
- `build-release.yml` also generates a GitHub artifact attestation for the released ZIP artifact(s)

If config cannot be recovered from the official release payload, the release workflow expects the `INFURA_PROJECT_ID` GitHub Actions secret.

## Local Development

```bash
corepack enable
corepack pnpm install
corepack pnpm run check:ci
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm test
```

Compiled CLIs are emitted under `dist/cli/`.

For automatic rewrites, use `pnpm run check` or `pnpm run format`.

## Documentation

- [Operations](docs/reference/operations.md)
- [Config Extraction](docs/reference/config-extraction.md)
- [Release Contract](docs/reference/release-contract.md)

## Verifying Released Artifacts

After downloading a published ZIP, verify its provenance with GitHub CLI:

```bash
gh attestation verify PATH/TO/metamask-chrome-<version>-no-lava.zip \
  -R synpress-io/metamask-extension-no-lavamoat
```

## Licensing

The source code in this repository is licensed under the MIT License. See [LICENSE](LICENSE).

Produced browser extension artifacts are built from official MetaMask source. Those artifacts and any derivative distribution remain subject to the upstream MetaMask license and notice requirements, not just this repository's MIT license.
