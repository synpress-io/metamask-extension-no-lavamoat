import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from '../src/lib/release-manifest.js';

describe('buildReleaseManifest', () => {
  it('records upstream and output artifacts', () => {
    const manifest = buildReleaseManifest({
      upstreamTag: 'v13.25.0',
      upstreamVersion: '13.25.0',
      sourceTarballUrl: 'https://example.test/source.tar.gz',
      officialChromeZipUrl: 'https://example.test/official-chrome.zip',
      officialChromeZipSha256: 'officialsha',
      builderReleaseTag: 'v13.25.0-no-lava',
      targets: ['chrome'],
      buildCommand: [
        'node',
        'development/build/index.js',
        'dist',
        '--apply-lavamoat=false',
        '--snow=false',
      ],
      assets: [
        {
          name: 'metamask-chrome-13.25.0-no-lava.zip',
          path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
          sha256: 'abc',
          size: 123,
        },
      ],
      repository: 'synpress-io/metamask-extension-no-lavamoat',
      commit: 'deadbeef',
      timestamp: '2026-04-02T00:00:00.000Z',
    });

    expect(manifest.upstream.tag).toBe('v13.25.0');
    expect(manifest.builder.tag).toBe('v13.25.0-no-lava');
    expect(manifest.build.targets).toEqual(['chrome']);
    expect(manifest.assets[0]?.sha256).toBe('abc');
  });
});
