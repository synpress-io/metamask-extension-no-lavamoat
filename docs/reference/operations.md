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

## Release Validation

Every built ZIP is checked for service-worker chunk completeness before it can be
hashed, attested or published. `build-release` runs the check on the release
copies and `publish-release` runs it again on the exact bytes it is about to
upload.

The check parses webpack's chunk-filename runtime (`__webpack_require__.u`) out
of the packaged service worker, then asserts that every chunk it will
`importScripts` at install time exists inside the same ZIP. It fails closed:

- a missing chunk fails the build with `INCOMPLETE_BUILT_ARTIFACT`;
- recognizing zero chunk references fails with `UNRECOGNIZED_CHUNK_REFERENCES`,
  because an empty reference set cannot be told apart from parser drift;
- a ZIP without a readable MV3 `background.service_worker` fails with
  `UNSUPPORTED_ARTIFACT_MANIFEST`.

This exists because a webpack build can drop an asynchronous chunk, still exit
`0`, and still produce a well-formed ZIP. `v13.45.0-no-lava` shipped that way:
`service-worker.js` referenced `1690.38d93430f4639781ca25.js`, the file was
absent, `importScripts` threw during `install`, and the extension never booted.

## Verifying a Published Artifact

```bash
gh attestation verify PATH/TO/metamask-chrome-<version>-no-lava.zip \
  -R synpress-io/metamask-extension-no-lavamoat
```
