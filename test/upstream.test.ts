import { describe, expect, it } from 'vitest';
import { MissingChromeAssetError } from '../src/lib/errors.js';
import { deriveReleaseRecord } from '../src/lib/upstream.js';

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
});
