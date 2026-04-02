# MetaMask Extension No-LavaMoat Builder

This repository builds and publishes prebuilt MetaMask extension artifacts without LavaMoat for Synpress-controlled automation environments.

## Purpose

- Build from official `MetaMask/metamask-extension` source tags.
- Reproduce a deterministic no-LavaMoat artifact pipeline in Synpress-owned infrastructure.
- Publish machine-readable provenance alongside every released artifact.

## Safety Boundaries

- These artifacts are for automated testing and controlled development environments only.
- This repository does not make any safety claim for real funds, real wallets, or mainnet usage.
- Disabling LavaMoat is an explicit security tradeoff and is only acceptable here because the target use case is browser-wallet automation, not end-user browsing.

## Release Model

- Upstream source of truth: official MetaMask GitHub releases and source tags.
- Builder release tag format: `vX.Y.Z-no-lavamoat`.
- Primary output target: Chromium/Chrome.
- Every published builder release must include:
  - built artifact ZIPs
  - `SHA256SUMS.txt`
  - `release-manifest.json`

## Local Commands

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

Compiled CLIs are emitted under `dist/cli/`.

Dry-run entrypoints and fixture-backed local verification are documented in [operations.md](/Users/jmucha/repos/ai-projects/metamask-extension-no-lavamoat/docs/reference/operations.md).
