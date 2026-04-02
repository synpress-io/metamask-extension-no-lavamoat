# MetaMask No-LavaMoat Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Synpress-owned automation repository that monitors official MetaMask releases, rebuilds selected tags without LavaMoat from official source, and publishes prebuilt artifacts plus release metadata for Synpress consumption.

**Architecture:** Keep this repository small and script-driven. Use repo-local TypeScript CLIs for release resolution, config extraction, build execution, and release manifest generation, while GitHub Actions stays thin and handles scheduling, permissions, and publishing. Treat the official MetaMask release ZIP and source tarball as the only authoritative inputs; treat the dAppTest repo as workflow inspiration only.

**Tech Stack:** TypeScript on active LTS Node via Corepack + pnpm, Vitest, @biomejs/biome, Node built-ins plus minimal direct dependencies, official MetaMask source tarballs and release ZIPs, GitHub Actions, shell verification commands

---

## Planning Notes

- This repo should not become another general-purpose extension toolbelt. Keep the scope tight: resolve official tags, rebuild without LavaMoat, publish artifacts, record provenance.
- This is now a Node/TypeScript repo. Before adding dependencies, apply the repo-local supply-chain baseline: pin the package manager, keep direct dependencies minimal, and commit the hardening config as part of Task 1.
- Prefer Node built-ins (`fetch`, `fs`, `crypto`, `child_process`, `stream`, `path`) and ubiquitous platform tools (`tar`, `unzip`, `gh`, `git`) over adding libraries for problems the platform already solves.
- Compile TypeScript to `dist/` for CI and release-critical execution. Do not make GitHub Actions depend on ad hoc inline shell logic or runtime-only transpilation.
- Fail closed on ambiguous config extraction. Silent best-effort behavior is not acceptable for build inputs.
- Keep a single source of truth for naming and policy in code. Release tag format, asset names, supported targets, and manifest shape should live in one contract module, not be redefined across CLIs and workflows.
- The first release target should be Chromium/Chrome because that is the primary Synpress extension-automation target. Firefox can remain optional until the core pipeline is stable.

## Planned File Structure

### Root docs and repo metadata

- `package.json`: package metadata, pinned package-manager field, script entrypoints, and exact direct dependencies
- `pnpm-lock.yaml`: committed lockfile
- `.npmrc`: repo-local install and pinning policy from the Node hardening baseline
- `tsconfig.json`: strict TypeScript compiler configuration for both app code and tests
- `vitest.config.ts`: test runner config
- `README.md`: repo purpose, warnings, usage, and release policy
- `docs/reference/release-contract.md`: artifact naming, metadata schema, and consumer contract for Synpress
- `docs/reference/config-extraction.md`: how official release assets are inspected and which values are allowed to come from secrets
- `docs/reference/operations.md`: local verification and GitHub Actions runbook

### TypeScript builder implementation

- `src/lib/contracts.ts`: single source of truth for release suffixes, asset naming, supported targets, and manifest field names
- `src/lib/errors.ts`: typed domain errors for fail-fast CLI behavior
- `src/lib/upstream.ts`: official release/tag lookup and asset metadata resolution
- `src/lib/config.ts`: extract build-time config from official release ZIP with secret fallback policy
- `src/lib/source.ts`: source tarball download/extract logic
- `src/lib/build.ts`: ephemeral MetaMask build workspace orchestration
- `src/lib/release-manifest.ts`: manifest + checksum generation
- `src/lib/github-release.ts`: release existence checks and upload command assembly
- `src/cli/check-for-upstream-release.ts`: machine-readable upstream monitoring entrypoint
- `src/cli/build-release.ts`: machine-readable single-tag build entrypoint

### Tests

- `test/repo-shape.test.ts`: repo foundation contract
- `test/upstream.test.ts`: tag and asset resolution behavior
- `test/config.test.ts`: official release ZIP scanning and fallback behavior
- `test/build-plan.test.ts`: build command assembly and workspace plan behavior
- `test/release-manifest.test.ts`: manifest schema and checksum generation
- `test/github-release.test.ts`: release naming/idempotency logic
- `test/workflows.test.ts`: workflow contract verification
- `test/local-cli-smoke.test.ts`: dry-run CLI behavior
- `test/fixtures/`: tiny fixture ZIP/JSON payloads for parser tests

### Workflow definitions

- `.github/workflows/monitor-releases.yml`: scheduled upstream tag detection
- `.github/workflows/build-release.yml`: manual or dispatched build/publish flow
- `.github/workflows/test.yml`: repo-local script verification on push and pull request

## Task 1: Establish the Node/TypeScript Foundation

**Files:**
- Create: `package.json`
- Create: `.npmrc`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `README.md`
- Create: `docs/reference/release-contract.md`
- Create: `docs/reference/config-extraction.md`
- Create: `docs/reference/operations.md`
- Create: `src/lib/contracts.ts`
- Create: `src/lib/errors.ts`
- Create: `test/repo-shape.test.ts`

- [ ] **Step 1: Add the minimal toolchain needed to run TypeScript tests**

Create the package and compiler baseline first because the repo is currently empty and cannot run any TypeScript test yet.

`package.json` should:

- pin the package manager with `packageManager`
- expose scripts for `build`, `typecheck`, `test`, `check:upstream`, and `build:release`
- keep direct dependencies empty unless a runtime dependency is truly required
- keep devDependencies minimal:
  - `typescript`
  - `vitest`
  - `tsx`
  - `@types/node`

`tsconfig.json` should:

- enable strict mode
- compile `src/**/*.ts` into `dist/`
- exclude `dist/`

`vitest.config.ts` should:

- run tests from `test/**/*.test.ts`
- disable watch mode in CI

`.npmrc` should:

- preserve exact pinning and lockfile discipline
- reflect the repo-local Node hardening baseline instead of default package-manager behavior

- [ ] **Step 2: Install the pinned toolchain**

Run:

```bash
corepack enable
pnpm install
```

Expected:

- `pnpm-lock.yaml` is created
- the install completes without adding runtime dependencies

- [ ] **Step 3: Write the failing repo-shape test**

```ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('repo foundation', () => {
  it('has the core builder surfaces', () => {
    const required = [
      'README.md',
      'docs/reference/release-contract.md',
      'docs/reference/config-extraction.md',
      'docs/reference/operations.md',
      'src/lib/contracts.ts',
      'src/lib/errors.ts',
    ];

    for (const relative of required) {
      expect(existsSync(relative), `${relative} should exist`).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run the repo-shape test to verify it fails**

Run:

```bash
pnpm test -- test/repo-shape.test.ts
```

Expected: FAIL because the repo docs and source files do not exist yet.

- [ ] **Step 5: Add the repo docs and package layout**

Write the initial docs and code contracts:

- `README.md`
  - this repo builds prebuilt MetaMask artifacts without LavaMoat for Synpress
  - artifacts are for controlled automation environments only
  - no real-funds / no-mainnet-safety claims
- `release-contract.md`
  - builder release tag naming policy
  - asset naming policy
  - manifest/checksum files shipped with each release
- `config-extraction.md`
  - allowed extracted values
  - secret fallback policy
  - fail-closed conditions
- `operations.md`
  - local dry-run commands
  - workflow names
  - expected secrets
- `src/lib/contracts.ts`
  - builder suffix constant
  - supported targets
  - asset naming helpers
  - manifest key constants
- `src/lib/errors.ts`
  - typed errors for missing Chrome asset, ambiguous config, missing secret fallback, and failed build outputs

- [ ] **Step 6: Re-run the foundation checks**

Run:

```bash
pnpm test -- test/repo-shape.test.ts
pnpm run typecheck
```

Expected: PASS

- [ ] **Step 7: Commit the repo foundation**

```bash
git add package.json pnpm-lock.yaml .npmrc tsconfig.json vitest.config.ts README.md docs src/lib/contracts.ts src/lib/errors.ts test/repo-shape.test.ts
git commit -m "chore: define builder repo foundation"
```

## Task 2: Implement Upstream Tag and Asset Resolution

**Files:**
- Create: `src/lib/upstream.ts`
- Create: `src/cli/check-for-upstream-release.ts`
- Create: `test/upstream.test.ts`

- [ ] **Step 1: Write the failing upstream-resolution tests**

```ts
import { describe, expect, it } from 'vitest';
import { deriveReleaseRecord } from '../src/lib/upstream';

describe('deriveReleaseRecord', () => {
  it('extracts tag, version, and chrome asset details', () => {
    const record = deriveReleaseRecord({
      tag_name: 'v13.25.0',
      assets: [
        {
          name: 'metamask-chrome-13.25.0.zip',
          browser_download_url: 'https://example.test/chrome.zip',
          digest: 'sha256:abc',
        },
      ],
    });

    expect(record.tag).toBe('v13.25.0');
    expect(record.version).toBe('13.25.0');
    expect(record.chromeZipUrl).toBe('https://example.test/chrome.zip');
    expect(record.chromeZipSha256).toBe('abc');
  });
});
```

- [ ] **Step 2: Run the upstream tests to verify they fail**

Run:

```bash
pnpm test -- test/upstream.test.ts
```

Expected: FAIL because the upstream module does not exist yet.

- [ ] **Step 3: Implement `src/lib/upstream.ts`**

Implement:

- official latest-release lookup
- requested-tag lookup
- normalization into one release record object containing:
  - upstream tag
  - semantic version
  - source tarball URL
  - Chrome asset URL
  - optional Firefox asset URL
  - asset SHA-256 values when present in GitHub metadata

No hidden implicit defaults. If the expected Chrome asset is missing, throw a typed domain error immediately.

- [ ] **Step 4: Implement `src/cli/check-for-upstream-release.ts`**

The CLI should:

- fetch the latest upstream tag or resolve a requested tag
- compute the repo’s builder release tag convention from `src/lib/contracts.ts`
- print a machine-readable decision for workflows:
  - latest upstream tag
  - derived builder release tag
  - should build yes/no

- [ ] **Step 5: Re-run the upstream tests**

Run:

```bash
pnpm test -- test/upstream.test.ts
pnpm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit upstream resolution**

```bash
git add src/lib/upstream.ts src/cli/check-for-upstream-release.ts test/upstream.test.ts
git commit -m "feat: add upstream release resolution"
```

## Task 3: Implement Official Release ZIP Config Extraction

**Files:**
- Create: `src/lib/config.ts`
- Create: `test/config.test.ts`
- Create: `test/fixtures/official-release-payloads/`

- [ ] **Step 1: Write the failing config-extraction tests**

```ts
import { describe, expect, it } from 'vitest';
import { resolveBuildConfig } from '../src/lib/config';

describe('resolveBuildConfig', () => {
  it('prefers values extracted from the official release zip', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: ["var infuraProjectId = '0123456789abcdef0123456789abcdef';"],
      secretInfuraProjectId: 'fallback',
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
  });

  it('falls back to the secret only when extraction fails cleanly', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: [],
      secretInfuraProjectId: 'fallback',
    });

    expect(config.infuraProjectId).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run the config tests to verify they fail**

Run:

```bash
pnpm test -- test/config.test.ts
```

Expected: FAIL because the config module does not exist yet.

- [ ] **Step 3: Implement config extraction**

Implement:

- ZIP scan logic for the official release asset
- narrow regex extraction for the Infura project ID
- secret fallback only when extraction fails cleanly
- typed failure when neither extracted nor secret value exists

Keep the extracted field set intentionally small. Do not scrape arbitrary config just because it is available.

- [ ] **Step 4: Re-run the config tests**

Run:

```bash
pnpm test -- test/config.test.ts
pnpm run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit config extraction**

```bash
git add src/lib/config.ts test/config.test.ts test/fixtures/official-release-payloads
git commit -m "feat: add official release config extraction"
```

## Task 4: Implement Source Download and No-LavaMoat Build Orchestration

**Files:**
- Create: `src/lib/source.ts`
- Create: `src/lib/build.ts`
- Create: `src/cli/build-release.ts`
- Create: `test/build-plan.test.ts`

- [ ] **Step 1: Write the failing build-orchestration tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildCommandFor } from '../src/lib/build';

describe('buildCommandFor', () => {
  it('uses official source and disables LavaMoat', () => {
    expect(buildCommandFor({ buildTarget: 'dist' })).toEqual([
      'node',
      'development/build/index.js',
      'dist',
      '--apply-lavamoat=false',
      '--snow=false',
    ]);
  });
});
```

- [ ] **Step 2: Run the build-plan tests to verify they fail**

Run:

```bash
pnpm test -- test/build-plan.test.ts
```

Expected: FAIL because the build module does not exist yet.

- [ ] **Step 3: Implement `src/lib/source.ts` and `src/lib/build.ts`**

Implement:

- source tarball download for a requested official tag
- extract into a temporary build workspace
- generate `.metamaskrc` with the resolved config
- run dependency installation inside the extracted MetaMask source
- execute the no-LavaMoat build command
- verify expected built ZIPs exist after completion

The build orchestration should support:

- `chrome` required
- `firefox` optional
- exact tag input only

- [ ] **Step 4: Implement `src/cli/build-release.ts`**

The top-level CLI should:

- accept an explicit tag or resolve latest
- resolve upstream release metadata
- resolve build config
- download official source
- run the build
- emit a local manifest/checksum summary

- [ ] **Step 5: Run the build-plan tests**

Run:

```bash
pnpm test -- test/build-plan.test.ts
pnpm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit build orchestration**

```bash
git add src/lib/source.ts src/lib/build.ts src/cli/build-release.ts test/build-plan.test.ts
git commit -m "feat: add no-lavamoat build orchestration"
```

## Task 5: Implement Release Manifest and Publishing Logic

**Files:**
- Create: `src/lib/release-manifest.ts`
- Create: `src/lib/github-release.ts`
- Create: `test/release-manifest.test.ts`
- Create: `test/github-release.test.ts`

- [ ] **Step 1: Write the failing manifest and release tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from '../src/lib/release-manifest';

describe('buildReleaseManifest', () => {
  it('records upstream and output artifacts', () => {
    const manifest = buildReleaseManifest({
      upstreamTag: 'v13.25.0',
      builderReleaseTag: 'v13.25.0-no-lavamoat',
      assets: [{ name: 'metamask-chrome-13.25.0.zip', sha256: 'abc' }],
    });

    expect(manifest.upstream.tag).toBe('v13.25.0');
    expect(manifest.builder.tag).toBe('v13.25.0-no-lavamoat');
    expect(manifest.assets[0]?.sha256).toBe('abc');
  });
});
```

- [ ] **Step 2: Run the manifest/release tests to verify they fail**

Run:

```bash
pnpm test -- test/release-manifest.test.ts
pnpm test -- test/github-release.test.ts
```

Expected: FAIL because the manifest and release modules do not exist yet.

- [ ] **Step 3: Implement manifest generation**

The manifest should include:

- upstream tag
- source tarball URL
- official release ZIP URL and digest
- build command used
- produced artifact names and SHA-256 values
- builder repo commit, when available
- build timestamp

- [ ] **Step 4: Implement release naming and idempotency rules**

Implement:

- builder release tag convention: `vX.Y.Z-no-lavamoat`
- release existence check before publish
- upload command assembly for:
  - artifact ZIPs
  - checksum file
  - release manifest JSON

- [ ] **Step 5: Re-run the manifest/release tests**

Run:

```bash
pnpm test -- test/release-manifest.test.ts
pnpm test -- test/github-release.test.ts
pnpm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit manifest and release logic**

```bash
git add src/lib/release-manifest.ts src/lib/github-release.ts test/release-manifest.test.ts test/github-release.test.ts
git commit -m "feat: add release manifest and publish logic"
```

## Task 6: Add GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/monitor-releases.yml`
- Create: `.github/workflows/build-release.yml`
- Create: `.github/workflows/test.yml`
- Create: `test/workflows.test.ts`

- [ ] **Step 1: Write the failing workflow-contract test**

Add a repository test that asserts these workflow files exist and contain the expected job names or compiled entrypoint commands.

- [ ] **Step 2: Run the workflow-contract test to verify it fails**

Run:

```bash
pnpm test -- test/workflows.test.ts
```

Expected: FAIL because the workflow files and test do not exist yet.

- [ ] **Step 3: Implement `monitor-releases.yml`**

The monitor workflow should:

- run on schedule and manual dispatch
- resolve the latest official upstream tag
- derive the builder release tag
- skip cleanly if the builder release already exists
- dispatch the build workflow with the requested upstream tag

- [ ] **Step 4: Implement `build-release.yml`**

The build workflow should:

- accept manual and dispatch triggers
- set up Node and Corepack/pnpm
- build the TypeScript CLIs once
- run the repo’s compiled entrypoints instead of embedding all logic inline in shell
- build and publish artifacts
- upload manifest and checksum files

- [ ] **Step 5: Implement `test.yml`**

The repo verification workflow should run install, typecheck, build, and test on pull requests and pushes.

- [ ] **Step 6: Re-run the workflow-contract test**

Run:

```bash
pnpm test -- test/workflows.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit workflows**

```bash
git add .github/workflows test/workflows.test.ts
git commit -m "ci: add monitor and build-release workflows"
```

## Task 7: Local Verification and Ops Polish

**Files:**
- Modify: `README.md`
- Modify: `docs/reference/operations.md`
- Create: `test/local-cli-smoke.test.ts`

- [ ] **Step 1: Write the failing local CLI smoke test**

Add a smoke test that runs the compiled CLIs in dry-run or fixture mode and asserts machine-readable output.

- [ ] **Step 2: Run the local smoke test to verify it fails**

Run:

```bash
pnpm test -- test/local-cli-smoke.test.ts
```

Expected: FAIL because the dry-run behavior or smoke test does not exist yet.

- [ ] **Step 3: Add dry-run / local verification support**

Support commands such as:

```bash
pnpm run build
node dist/cli/check-for-upstream-release.js --dry-run --tag v13.25.0
node dist/cli/build-release.js --tag v13.25.0 --dry-run
```

These should:

- avoid publishing
- avoid long-lived source builds unless explicitly requested
- print the resolved release/build plan clearly

- [ ] **Step 4: Re-run the local smoke tests and full suite**

Run:

```bash
pnpm run build
pnpm test
```

Expected: PASS

- [ ] **Step 5: Commit local verification support**

```bash
git add README.md docs/reference/operations.md test/local-cli-smoke.test.ts
git commit -m "chore: add local verification flow"
```

## Final Verification Gate

Before calling the repo ready for real builds, run:

```bash
pnpm run build
pnpm test
node dist/cli/check-for-upstream-release.js --dry-run --tag v13.25.0
node dist/cli/build-release.js --tag v13.25.0 --dry-run
```

Expected:

- all tests PASS
- the project compiles cleanly
- latest-tag resolution works
- build plan is rendered for a pinned official tag
- no publish step runs during dry-run

## Execution Notes

- Keep the first implementation Chromium-first. Add Firefox only when it does not complicate the release contract.
- Do not embed large shell programs directly into GitHub Actions when the same logic belongs in testable repo-local TypeScript.
- If MetaMask introduces additional required build inputs, add them to the explicit config contract and docs rather than silently copying more values out of the official ZIP.
- If the official source tag cannot be built with the expected command, surface that as a first-class failure with the exact upstream tag and command output.

Plan complete and saved to `docs/superpowers/plans/2026-04-02-metamask-no-lavamoat-builder-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
