# Release Contract

## Tag Naming

- Upstream MetaMask tags are consumed as published, for example `v13.25.0`.
- Builder releases append a single fixed suffix: `-no-lavamoat`.
- Example builder release tag: `v13.25.0-no-lavamoat`.

## Asset Naming

- Chrome artifact: `metamask-chrome-<version>-no-lavamoat.zip`
- Firefox artifact, when enabled: `metamask-firefox-<version>-no-lavamoat.zip`
- Checksums file: `SHA256SUMS.txt`
- Manifest file: `release-manifest.json`

## Required Manifest Fields

- `upstream`
  - `tag`
  - `version`
  - `sourceTarballUrl`
  - `officialAssets`
- `builder`
  - `tag`
  - `repository`
  - `commit`
  - `timestamp`
- `build`
  - `targets`
  - `command`
  - `lavamoat`
- `assets`
  - `name`
  - `sha256`
  - `size`

## Consumer Expectations

- Synpress should be able to pin a builder release tag and verify artifact checksums without rebuilding MetaMask locally.
- A builder release must be idempotent for a given upstream tag. Re-running the pipeline must either skip or reproduce the exact same release contract.
