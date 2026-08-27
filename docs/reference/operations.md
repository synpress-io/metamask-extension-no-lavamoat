# Operations

## Workflows

- `test.yml`: install, typecheck, build, and test this repository.
- `monitor-releases.yml`: detect the latest official MetaMask release and decide whether a builder release is required.
- `build-release.yml`: build and optionally publish a builder release for a pinned upstream tag.
- `build-release.yml`: generate a GitHub provenance attestation for released ZIP artifact(s).

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

## Build-Time Dependency Patches

After `yarn install` and before anything compiles, the builder patches
`html-bundler-webpack-plugin` inside the MetaMask workspace. See
`src/lib/dependency-patch.ts` for the exact anchor and replacement.

The plugin's "remove generated unused split chunks" pass matches chunks by
chunk-id intersection with the HTML pages' entrypoint chunk ids, then deletes by
file name. webpack merges duplicate chunks across runtimes, so MetaMask's
service-worker chunk carries a second id belonging to a page chunk, and the
plugin deletes the service worker's only copy of it. LavaMoat-enabled official
builds partition chunks differently and never collide, so only `--no-lavamoat`
builds are affected. The patch keeps the pass's intent but decides membership by
filename in the pages' own chunk groups.

The patch is fail-closed: the anchored source is matched verbatim, so a plugin
release that changes that block fails the build with
`DEPENDENCY_PATCH_ANCHOR_MISSING` rather than silently building unpatched. Every
applied patch is recorded in `build.dependencyPatches` in the published
`release-manifest.json`, so a consumer can always tell how an artifact differs
from what an unmodified upstream checkout would produce.

Remove the patch once the fix is released upstream.

## Blocked Upstream Tags

`src/lib/blocked-upstream-tags.ts` lists upstream tags that must not be built,
with a reason and an issue link. `check-for-upstream-release` reports
`shouldBuild: false` and a `blockedReason` for them, which keeps the hourly
monitor green instead of failing the same impossible build every hour.
Unblocking is a reviewable change to that file. Empty is the healthy state.

## Release Validation

Every built ZIP is checked for chunk completeness before it can be hashed,
attested or published. `build-release` runs the check on the release copies and
`publish-release` runs it again on the exact bytes it is about to upload.

The check parses webpack's chunk-filename runtime (`__webpack_require__.u`) out
of **every** packaged `.js` entry, not just the service worker: MetaMask ships a
service-worker runtime and a separate UI runtime, and a chunk lost from either
breaks the surfaces that depend on it. It then asserts that every chunk any
runtime can load exists inside the same ZIP. It fails closed:

- a missing chunk fails with `INCOMPLETE_BUILT_ARTIFACT`, naming every missing
  file;
- recognizing no chunk-loading runtime anywhere fails with
  `UNRECOGNIZED_CHUNK_REFERENCES`, because that cannot be told apart from parser
  drift;
- a ZIP without a readable MV3 `background.service_worker` fails with
  `UNSUPPORTED_ARTIFACT_MANIFEST`;
- a release carrying no inspectable artifact fails with
  `NO_VERIFIABLE_ARTIFACT`, so the gate cannot pass vacuously.

This exists because a webpack build can drop an asynchronous chunk, still exit
`0`, and still produce a well-formed ZIP. `v13.45.0-no-lava` shipped that way:
`service-worker.js` referenced `1690.38d93430f4639781ca25.js`, the file was
absent, `importScripts` threw during `install`, and the extension never booted.

## Verifying a Published Artifact

```bash
gh attestation verify PATH/TO/metamask-chrome-<version>-no-lava.zip \
  -R synpress-io/metamask-extension-no-lavamoat
```
