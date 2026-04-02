import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingChromeAssetError } from '../src/lib/errors.js';
import { buildReleaseCheckDecision, deriveReleaseRecord, resolveReleaseCheckDecision } from '../src/lib/upstream.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('deriveReleaseRecord', () => {
  it('extracts tag, version, and chrome asset details', () => {
    const record = deriveReleaseRecord({
      tag_name: 'v13.25.0',
      tarball_url: 'https://example.test/source.tar.gz',
      assets: [
        {
          name: 'metamask-chrome-13.25.0.zip',
          browser_download_url: 'https://example.test/chrome.zip',
          digest: 'sha256:abc'
        },
        {
          name: 'metamask-firefox-13.25.0.zip',
          browser_download_url: 'https://example.test/firefox.zip',
          digest: 'sha256:def'
        }
      ]
    });

    expect(record.tag).toBe('v13.25.0');
    expect(record.version).toBe('13.25.0');
    expect(record.sourceTarballUrl).toBe('https://example.test/source.tar.gz');
    expect(record.chromeZipUrl).toBe('https://example.test/chrome.zip');
    expect(record.chromeZipSha256).toBe('abc');
    expect(record.firefoxZipUrl).toBe('https://example.test/firefox.zip');
    expect(record.firefoxZipSha256).toBe('def');
  });

  it('throws when the required chrome asset is missing', () => {
    expect(() =>
      deriveReleaseRecord({
        tag_name: 'v13.25.0',
        tarball_url: 'https://example.test/source.tar.gz',
        assets: []
      })
    ).toThrow(MissingChromeAssetError);
  });

  it('requires a rebuild when the release tag exists but required assets are missing', () => {
    const decision = buildReleaseCheckDecision({
      release: {
        tag: 'v13.25.0',
        version: '13.25.0',
        sourceTarballUrl: 'https://example.test/source.tar.gz',
        chromeZipUrl: 'https://example.test/chrome.zip'
      },
      builderReleaseExists: true,
      builderReleaseAssetNames: ['metamask-chrome-13.25.0-no-lavamoat.zip']
    });

    expect(decision.shouldBuild).toBe(true);
    expect(decision.builderReleaseExists).toBe(true);
  });

  it('requires a rebuild when the release assets exist but published integrity is invalid', () => {
    const decision = buildReleaseCheckDecision({
      release: {
        tag: 'v13.25.0',
        version: '13.25.0',
        sourceTarballUrl: 'https://example.test/source.tar.gz',
        chromeZipUrl: 'https://example.test/chrome.zip'
      },
      builderReleaseExists: true,
      builderReleaseAssetNames: [
        'metamask-chrome-13.25.0-no-lavamoat.zip',
        'SHA256SUMS.txt',
        'release-manifest.json'
      ],
      builderReleaseIntegrityValid: false
    });

    expect(decision.shouldBuild).toBe(true);
    expect(decision.builderReleaseComplete).toBe(true);
    expect(decision.builderReleaseIntegrityValid).toBe(false);
  });

  it('fails closed when builder release inspection errors', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tag_name: 'v13.25.0',
            tarball_url: 'https://example.test/source.tar.gz',
            assets: [
              {
                name: 'metamask-chrome-13.25.0.zip',
                browser_download_url: 'https://example.test/chrome.zip'
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockRejectedValueOnce(new Error('transient GitHub failure')) as typeof fetch;

    await expect(resolveReleaseCheckDecision('v13.25.0')).rejects.toThrow('transient GitHub failure');
  });
});
