import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGitHubReleasePublishPlan,
  ensureGitHubReleaseAssets,
  evaluateReleaseCompleteness,
  inspectPublishedReleaseIntegrity,
  missingReleaseAssetPaths,
  prepareReleaseArtifactCopies,
} from '../src/lib/github-release.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('buildGitHubReleasePublishPlan', () => {
  it('creates the builder release tag and upload asset list', () => {
    const plan = buildGitHubReleasePublishPlan({
      upstreamTag: 'v13.25.0',
      artifactPaths: ['/tmp/metamask-chrome-13.25.0-no-lava.zip'],
      checksumsPath: '/tmp/SHA256SUMS.txt',
      manifestPath: '/tmp/release-manifest.json',
    });

    expect(plan.tag).toBe('v13.25.0-no-lava');
    expect(plan.title).toBe('v13.25.0 (No Lava)');
    expect(plan.assetPaths).toEqual([
      '/tmp/metamask-chrome-13.25.0-no-lava.zip',
      '/tmp/SHA256SUMS.txt',
      '/tmp/release-manifest.json',
    ]);
  });

  it('copies built artifacts to canonical published names', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'mm-gh-release-source-'));
    const releaseDir = mkdtempSync(join(tmpdir(), 'mm-gh-release-output-'));

    try {
      const upstreamChromeZip = join(sourceDir, 'metamask-chrome-13.25.0.zip');
      writeFileSync(upstreamChromeZip, 'zip-content', 'utf8');

      const copied = await prepareReleaseArtifactCopies({
        releaseDirectory: releaseDir,
        version: '13.25.0',
        artifactSources: {
          chrome: upstreamChromeZip,
        },
      });

      expect(copied.chrome).toBe(join(releaseDir, 'metamask-chrome-13.25.0-no-lava.zip'));
      expect(existsSync(copied.chrome as string)).toBe(true);
    } finally {
      rmSync(sourceDir, { force: true, recursive: true });
      rmSync(releaseDir, { force: true, recursive: true });
    }
  });

  it('detects incomplete releases when required assets are missing', () => {
    const evaluation = evaluateReleaseCompleteness({
      expectedAssetNames: [
        'metamask-chrome-13.25.0-no-lava.zip',
        'SHA256SUMS.txt',
        'release-manifest.json',
      ],
      actualAssetNames: ['metamask-chrome-13.25.0-no-lava.zip'],
    });

    expect(evaluation.complete).toBe(false);
    expect(evaluation.missingAssetNames).toEqual(['SHA256SUMS.txt', 'release-manifest.json']);
  });

  it('derives missing release asset paths from inspected asset names', () => {
    const missingPaths = missingReleaseAssetPaths(
      [
        '/tmp/metamask-chrome-13.25.0-no-lava.zip',
        '/tmp/SHA256SUMS.txt',
        '/tmp/release-manifest.json',
      ],
      ['metamask-chrome-13.25.0-no-lava.zip'],
    );

    expect(missingPaths).toEqual(['/tmp/SHA256SUMS.txt', '/tmp/release-manifest.json']);
  });

  it('repairs an existing incomplete release by uploading missing assets', async () => {
    const inspections = [
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: 'sha256:zip-digest',
          },
        ],
        assetNames: ['metamask-chrome-13.25.0-no-lava.zip'],
      },
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: 'sha256:zip-digest',
          },
          {
            name: 'SHA256SUMS.txt',
            digest: 'sha256:checksums-digest',
          },
          {
            name: 'release-manifest.json',
            digest: 'sha256:manifest-digest',
          },
        ],
        assetNames: [
          'metamask-chrome-13.25.0-no-lava.zip',
          'SHA256SUMS.txt',
          'release-manifest.json',
        ],
      },
    ];
    const uploadCalls: string[][] = [];

    const result = await ensureGitHubReleaseAssets(
      {
        repository: 'synpress-io/metamask-extension-no-lavamoat',
        releaseTag: 'v13.25.0-no-lava',
        releaseTitle: 'v13.25.0 (No Lava)',
        releaseNotes: 'notes',
        assets: [
          {
            path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
            sha256: 'zip-digest',
          },
          {
            path: '/tmp/SHA256SUMS.txt',
            sha256: 'checksums-digest',
          },
          {
            path: '/tmp/release-manifest.json',
            sha256: 'manifest-digest',
          },
        ],
      },
      {
        async inspectRelease() {
          const next = inspections.shift();
          if (!next) {
            throw new Error('unexpected inspection');
          }
          return next;
        },
        async createRelease() {
          throw new Error('createRelease should not be called for an existing release');
        },
        async uploadAssets(_releaseTag, _repository, assetPaths) {
          uploadCalls.push(assetPaths);
        },
      },
    );

    expect(uploadCalls).toEqual([['/tmp/SHA256SUMS.txt', '/tmp/release-manifest.json']]);
    expect(result.created).toBe(false);
    expect(result.repaired).toBe(true);
    expect(result.missingAssetNames).toEqual([]);
  });

  it('repairs a partial release after create failure when the release object already exists', async () => {
    const inspections = [
      {
        exists: false,
        assets: [],
        assetNames: [],
      },
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: 'sha256:zip-digest',
          },
        ],
        assetNames: ['metamask-chrome-13.25.0-no-lava.zip'],
      },
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: 'sha256:zip-digest',
          },
          {
            name: 'SHA256SUMS.txt',
            digest: 'sha256:checksums-digest',
          },
          {
            name: 'release-manifest.json',
            digest: 'sha256:manifest-digest',
          },
        ],
        assetNames: [
          'metamask-chrome-13.25.0-no-lava.zip',
          'SHA256SUMS.txt',
          'release-manifest.json',
        ],
      },
    ];
    const uploadCalls: string[][] = [];

    const result = await ensureGitHubReleaseAssets(
      {
        repository: 'synpress-io/metamask-extension-no-lavamoat',
        releaseTag: 'v13.25.0-no-lava',
        releaseTitle: 'v13.25.0 (No Lava)',
        releaseNotes: 'notes',
        assets: [
          {
            path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
            sha256: 'zip-digest',
          },
          {
            path: '/tmp/SHA256SUMS.txt',
            sha256: 'checksums-digest',
          },
          {
            path: '/tmp/release-manifest.json',
            sha256: 'manifest-digest',
          },
        ],
      },
      {
        async inspectRelease() {
          const next = inspections.shift();
          if (!next) {
            throw new Error('unexpected inspection');
          }
          return next;
        },
        async createRelease() {
          throw new Error('simulated gh release create failure');
        },
        async uploadAssets(_releaseTag, _repository, assetPaths) {
          uploadCalls.push(assetPaths);
        },
      },
    );

    expect(uploadCalls).toEqual([['/tmp/SHA256SUMS.txt', '/tmp/release-manifest.json']]);
    expect(result.created).toBe(false);
    expect(result.repaired).toBe(true);
    expect(result.missingAssetNames).toEqual([]);
  });

  it('re-uploads assets when a matching filename has the wrong digest', async () => {
    const inspections = [
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: 'sha256:stale-digest',
          },
          {
            name: 'SHA256SUMS.txt',
            digest: 'sha256:checksums-digest',
          },
          {
            name: 'release-manifest.json',
            digest: 'sha256:manifest-digest',
          },
        ],
        assetNames: [
          'metamask-chrome-13.25.0-no-lava.zip',
          'SHA256SUMS.txt',
          'release-manifest.json',
        ],
      },
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: 'sha256:zip-digest',
          },
          {
            name: 'SHA256SUMS.txt',
            digest: 'sha256:checksums-digest',
          },
          {
            name: 'release-manifest.json',
            digest: 'sha256:manifest-digest',
          },
        ],
        assetNames: [
          'metamask-chrome-13.25.0-no-lava.zip',
          'SHA256SUMS.txt',
          'release-manifest.json',
        ],
      },
    ];
    const uploadCalls: string[][] = [];

    const result = await ensureGitHubReleaseAssets(
      {
        repository: 'synpress-io/metamask-extension-no-lavamoat',
        releaseTag: 'v13.25.0-no-lava',
        releaseTitle: 'v13.25.0 (No Lava)',
        releaseNotes: 'notes',
        assets: [
          {
            path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
            sha256: 'zip-digest',
          },
          {
            path: '/tmp/SHA256SUMS.txt',
            sha256: 'checksums-digest',
          },
          {
            path: '/tmp/release-manifest.json',
            sha256: 'manifest-digest',
          },
        ],
      },
      {
        async inspectRelease() {
          const next = inspections.shift();
          if (!next) {
            throw new Error('unexpected inspection');
          }
          return next;
        },
        async createRelease() {
          throw new Error('createRelease should not be called for an existing release');
        },
        async uploadAssets(_releaseTag, _repository, assetPaths) {
          uploadCalls.push(assetPaths);
        },
      },
    );

    expect(uploadCalls).toEqual([['/tmp/metamask-chrome-13.25.0-no-lava.zip']]);
    expect(result.created).toBe(false);
    expect(result.repaired).toBe(true);
    expect(result.missingAssetNames).toEqual([]);
  });

  it('marks a published release invalid when manifest/checksums disagree with uploaded asset digests', async () => {
    const expectedDigest = 'a'.repeat(64);
    const wrongDigest = 'b'.repeat(64);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith('/release-manifest.json')) {
        return new Response(
          JSON.stringify({
            upstream: {
              tag: 'v13.25.0',
              version: '13.25.0',
              sourceTarballUrl: 'https://example.test/source.tar.gz',
              officialAssets: {
                chrome: {
                  url: 'https://example.test/chrome.zip',
                },
              },
            },
            builder: {
              tag: 'v13.25.0-no-lava',
              repository: 'synpress-io/metamask-extension-no-lavamoat',
              timestamp: '2026-04-02T00:00:00.000Z',
            },
            build: {
              targets: ['chrome'],
              command: [
                'node',
                'development/build/index.js',
                'dist',
                '--apply-lavamoat=false',
                '--snow=false',
              ],
              lavamoat: false,
            },
            assets: [
              {
                name: 'metamask-chrome-13.25.0-no-lava.zip',
                path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
                sha256: expectedDigest,
                size: 123,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.endsWith('/SHA256SUMS.txt')) {
        return new Response(`${expectedDigest}  metamask-chrome-13.25.0-no-lava.zip\n`, {
          status: 200,
        });
      }

      throw new Error(`unexpected fetch for ${url}`);
    }) as typeof fetch;

    const integrity = await inspectPublishedReleaseIntegrity({
      exists: true,
      assets: [
        {
          name: 'metamask-chrome-13.25.0-no-lava.zip',
          digest: `sha256:${wrongDigest}`,
        },
        {
          name: 'release-manifest.json',
          browserDownloadUrl: 'https://example.test/release-manifest.json',
        },
        {
          name: 'SHA256SUMS.txt',
          browserDownloadUrl: 'https://example.test/SHA256SUMS.txt',
        },
      ],
      assetNames: [
        'metamask-chrome-13.25.0-no-lava.zip',
        'release-manifest.json',
        'SHA256SUMS.txt',
      ],
    });

    expect(integrity.valid).toBe(false);
    expect(integrity.mismatchedAssetNames).toEqual(['metamask-chrome-13.25.0-no-lava.zip']);
  });

  it('marks a published release invalid when the manifest is malformed or empty', async () => {
    const wrongDigest = 'b'.repeat(64);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith('/release-manifest.json')) {
        return new Response('{"assets":[]}', { status: 200 });
      }

      if (url.endsWith('/SHA256SUMS.txt')) {
        return new Response('', { status: 200 });
      }

      throw new Error(`unexpected fetch for ${url}`);
    }) as typeof fetch;

    const integrity = await inspectPublishedReleaseIntegrity({
      exists: true,
      assets: [
        {
          name: 'metamask-chrome-13.25.0-no-lava.zip',
          digest: `sha256:${wrongDigest}`,
        },
        {
          name: 'release-manifest.json',
          browserDownloadUrl: 'https://example.test/release-manifest.json',
        },
        {
          name: 'SHA256SUMS.txt',
          browserDownloadUrl: 'https://example.test/SHA256SUMS.txt',
        },
      ],
      assetNames: [
        'metamask-chrome-13.25.0-no-lava.zip',
        'release-manifest.json',
        'SHA256SUMS.txt',
      ],
    });

    expect(integrity.valid).toBe(false);
    expect(integrity.mismatchedAssetNames).toEqual(['release-manifest.json']);
  });

  it('marks a published release invalid when the manifest binding does not match the expected release', async () => {
    const digest = 'a'.repeat(64);
    const officialDigest = 'c'.repeat(64);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith('/release-manifest.json')) {
        return new Response(
          JSON.stringify({
            upstream: {
              tag: 'v13.24.0',
              version: '13.24.0',
              sourceTarballUrl: 'https://example.test/wrong-source.tar.gz',
              officialAssets: {
                chrome: {
                  url: 'https://example.test/wrong-chrome.zip',
                  sha256: officialDigest,
                },
              },
            },
            builder: {
              tag: 'v13.24.0-no-lava',
              repository: 'some-other/repo',
              timestamp: '2026-04-02T00:00:00.000Z',
            },
            build: {
              targets: ['chrome'],
              command: [
                'node',
                'development/build/index.js',
                'dist',
                '--apply-lavamoat=false',
                '--snow=false',
              ],
              lavamoat: false,
            },
            assets: [
              {
                name: 'metamask-chrome-13.25.0-no-lava.zip',
                path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
                sha256: digest,
                size: 123,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.endsWith('/SHA256SUMS.txt')) {
        return new Response(`${digest}  metamask-chrome-13.25.0-no-lava.zip\n`, {
          status: 200,
        });
      }

      throw new Error(`unexpected fetch for ${url}`);
    }) as typeof fetch;

    const integrity = await inspectPublishedReleaseIntegrity(
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: `sha256:${digest}`,
          },
          {
            name: 'release-manifest.json',
            browserDownloadUrl: 'https://example.test/release-manifest.json',
          },
          {
            name: 'SHA256SUMS.txt',
            browserDownloadUrl: 'https://example.test/SHA256SUMS.txt',
          },
        ],
        assetNames: [
          'metamask-chrome-13.25.0-no-lava.zip',
          'release-manifest.json',
          'SHA256SUMS.txt',
        ],
      },
      undefined,
      {
        expectedBuilderReleaseTag: 'v13.25.0-no-lava',
        expectedRepository: 'synpress-io/metamask-extension-no-lavamoat',
        expectedUpstreamTag: 'v13.25.0',
        expectedUpstreamVersion: '13.25.0',
        expectedSourceTarballUrl: 'https://example.test/source.tar.gz',
        expectedOfficialChromeZipUrl: 'https://example.test/chrome.zip',
        expectedOfficialChromeZipSha256: 'd'.repeat(64),
      },
    );

    expect(integrity.valid).toBe(false);
    expect(integrity.mismatchedAssetNames).toEqual(['release-manifest.json']);
  });

  it('downloads manifest and checksums through the GitHub asset api when direct release URLs are not readable', async () => {
    const digest = 'a'.repeat(64);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === 'https://api.example.test/assets/manifest') {
        return new Response(
          JSON.stringify({
            upstream: {
              tag: 'v13.25.0',
              version: '13.25.0',
              sourceTarballUrl: 'https://example.test/source.tar.gz',
              officialAssets: {
                chrome: {
                  url: 'https://example.test/chrome.zip',
                  sha256: 'b'.repeat(64),
                },
              },
            },
            builder: {
              tag: 'v13.25.0-no-lava',
              repository: 'synpress-io/metamask-extension-no-lavamoat',
              timestamp: '2026-04-02T00:00:00.000Z',
            },
            build: {
              targets: ['chrome'],
              command: [
                'node',
                'development/build/index.js',
                'dist',
                '--apply-lavamoat=false',
                '--snow=false',
              ],
              lavamoat: false,
            },
            assets: [
              {
                name: 'metamask-chrome-13.25.0-no-lava.zip',
                path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
                sha256: digest,
                size: 123,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url === 'https://api.example.test/assets/checksums') {
        return new Response(`${digest}  metamask-chrome-13.25.0-no-lava.zip\n`, {
          status: 200,
        });
      }

      if (url.endsWith('/release-manifest.json') || url.endsWith('/SHA256SUMS.txt')) {
        return new Response('not readable', { status: 404 });
      }

      throw new Error(`unexpected fetch for ${url}`);
    }) as typeof fetch;

    const integrity = await inspectPublishedReleaseIntegrity(
      {
        exists: true,
        assets: [
          {
            name: 'metamask-chrome-13.25.0-no-lava.zip',
            digest: `sha256:${digest}`,
          },
          {
            name: 'release-manifest.json',
            apiUrl: 'https://api.example.test/assets/manifest',
            browserDownloadUrl: 'https://example.test/release-manifest.json',
          },
          {
            name: 'SHA256SUMS.txt',
            apiUrl: 'https://api.example.test/assets/checksums',
            browserDownloadUrl: 'https://example.test/SHA256SUMS.txt',
          },
        ],
        assetNames: [
          'metamask-chrome-13.25.0-no-lava.zip',
          'release-manifest.json',
          'SHA256SUMS.txt',
        ],
      },
      undefined,
      {
        expectedBuilderReleaseTag: 'v13.25.0-no-lava',
        expectedRepository: 'synpress-io/metamask-extension-no-lavamoat',
        expectedUpstreamTag: 'v13.25.0',
        expectedUpstreamVersion: '13.25.0',
        expectedSourceTarballUrl: 'https://example.test/source.tar.gz',
        expectedOfficialChromeZipUrl: 'https://example.test/chrome.zip',
        expectedOfficialChromeZipSha256: 'b'.repeat(64),
      },
    );

    expect(integrity.valid).toBe(true);
    expect(integrity.missingAssetNames).toEqual([]);
    expect(integrity.mismatchedAssetNames).toEqual([]);
  });
});
