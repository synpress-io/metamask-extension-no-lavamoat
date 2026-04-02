# MetaMask no-LavaMoat builder and artifact pipeline

Created: 2026-04-02

## Objective
- Build a dedicated Synpress-owned automation repo that produces pinned prebuilt MetaMask extension artifacts without LavaMoat from official upstream source tags.
- Publish those artifacts with checksums and release metadata so Synpress can consume them without requiring end users to build MetaMask locally.
- Make the automation deterministic, auditable, and maintainable enough to track upstream MetaMask releases over time.

## Current State
- This repository was just bootstrapped and currently contains only the shared agent skeleton: `AGENTS.md`, `docs/`, `plans/`, and `resources/`.
- The first local reference input is `resources/dapptest-metamask-extension` at commit `085a1c463e5090f765691f8656ecf50b7bb09432` from `2025-05-17`.
- The dAppTest reference repo is intentionally minimal:
  - `monitor-releases.yml` checks official `MetaMask/metamask-extension` releases and dispatches a build when a matching `-no-lavamoat` release is missing.
  - `build&release.yml` downloads the official release ZIP, extracts an Infura project ID when possible, downloads the official source tarball for the same tag, builds with `dist --apply-lavamoat=false --snow=false`, and publishes new release ZIPs.
- Current upstream MetaMask state as of `2026-04-02`:
  - latest official release is `v13.25.0`, published `2026-04-01`
  - official release assets include Chrome and Firefox ZIPs plus SHA-256 digests
- There is no implementation yet in this repo:
  - no scripts
  - no workflows
  - no package manager or TypeScript project shape
  - no documentation beyond bootstrap placeholders

## Constraints
- Build from official `MetaMask/metamask-extension` source tags, not from third-party forks.
- Do not require end users to compile MetaMask on their own machines.
- Produce prebuilt artifacts that Synpress can pin and consume directly.
- Use the dAppTest repo only as a reference for the workflow shape, not as a release dependency or support baseline.
- Preserve reproducibility:
  - exact upstream tag
  - exact downloaded official asset
  - exact produced artifact checksums
  - explicit release metadata
- Fail closed when required build inputs are missing or ambiguous, especially config values such as the Infura project ID.
- Assume MetaMask build inputs and scripts can drift across releases; the automation must make that drift diagnosable.
- Prefer a small, direct implementation with first-class scripts and workflows over wrappers or hidden glue.
- Use repo-local TypeScript CLIs as the implementation surface and keep GitHub Actions thin.

## Non-Goals
- Do not build Synpress itself in this repo.
- Do not support arbitrary local source builds as the primary user experience.
- Do not depend on `dAppTest-dev/metamask-extension` artifacts in CI or production.
- Do not broaden scope into “all MetaMask build variants” beyond what Synpress needs first.
- Do not solve extension automation correctness here; this repo only builds and publishes artifacts.

## Acceptance Checks
- A maintainer can trigger a build for a specific official MetaMask tag and get prebuilt ZIP artifacts without LavaMoat.
- The automation can detect the latest official MetaMask release tag and decide whether a new builder release is needed.
- The builder can obtain required config values from the official release ZIP when possible, or fail over to explicitly provided secrets.
- Produced releases include:
  - built artifact ZIPs
  - SHA-256 checksums
  - machine-readable release metadata describing upstream source, build inputs, and produced outputs
- The pipeline is idempotent: rerunning for an already-published tag does not silently create duplicate or conflicting releases.
- The repo documents the security tradeoff and intended Synpress use clearly.

## Evidence To Collect
- The exact dAppTest workflow behaviors we are copying, changing, or rejecting.
- The exact official MetaMask release/tag and asset metadata used during design and verification.
- A sample dry-run or local verification output for tag resolution, config extraction, and build command assembly.
- A sample produced release manifest/checksum file shape.
- Workflow logs showing that the pipeline can:
  - resolve a target tag
  - fetch official source
  - build the artifact
  - publish a release or skip idempotently

## Review Gates
- The repository architecture is agreed before implementation starts:
  - likely a small script-driven repo with TypeScript CLIs as the implementation surface and GitHub Actions as the execution surface
  - no end-user local build requirement
- The release naming and artifact naming policy are explicit before publishing automation lands.
- The config extraction and secret fallback policy are explicit before build automation lands.
- Before the first real release is published, the pipeline should pass a dry run or equivalent bounded verification against a known upstream tag.

## Open Risks
- MetaMask may require additional environment variables or build inputs beyond what is currently extracted from official release assets.
- The official release ZIP structure may change, breaking config extraction heuristics.
- The MetaMask build command or toolchain requirements may drift between releases.
- Security and compliance concerns are non-trivial because disabling LavaMoat materially changes the extension’s security posture.
- GitHub-hosted release assets and workflow permissions may need tighter handling than the dAppTest reference currently uses.

## Next Handoff Step
- The implementation plan is ready at:
  - `docs/superpowers/plans/2026-04-02-metamask-no-lavamoat-builder-implementation.md`
- Next execution step:
  - start Task 1 from the implementation plan
  - keep this contract current as the repo moves from empty scaffold to working builder automation
  - archive this contract only after the builder pipeline is implemented and verified
