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
        'development/.webpack/launch.js',
        '--no-cache',
        '--mode',
        'production',
        '--no-lavamoat',
        '--no-snow',
        '--zip',
        '--browser',
        'chrome',
      ],
      assets: [
        {
          name: 'metamask-chrome-13.25.0-no-lava.zip',
          path: '/tmp/metamask-chrome-13.25.0-no-lava.zip',
          sha256: 'abc',
          size: 123,
        },
      ],
      dependencyPatches: [
        {
          packageName: 'html-bundler-webpack-plugin',
          packageVersion: '4.23.2',
          filePath: 'src/Plugin/Collection.js',
          reason: 'deletes service worker chunks that share a merged id with a page chunk',
          issueUrl: 'https://github.com/drptbl/synpress-ngen/issues/1',
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

  it('publishes the build-time dependency corrections as provenance', () => {
    // A published artifact must always state how it differs from what an
    // unmodified upstream checkout would produce.
    const manifest = buildReleaseManifest({
      upstreamTag: 'v13.45.1',
      upstreamVersion: '13.45.1',
      sourceTarballUrl: 'https://example.test/source.tar.gz',
      officialChromeZipUrl: 'https://example.test/official-chrome.zip',
      builderReleaseTag: 'v13.45.1-no-lava',
      targets: ['chrome'],
      buildCommand: ['node', 'development/.webpack/launch.js'],
      assets: [
        {
          name: 'metamask-chrome-13.45.1-no-lava.zip',
          path: '/tmp/metamask-chrome-13.45.1-no-lava.zip',
          sha256: 'abc',
          size: 1,
        },
      ],
      dependencyPatches: [
        {
          packageName: 'html-bundler-webpack-plugin',
          packageVersion: '4.23.2',
          filePath: 'src/Plugin/Collection.js',
          reason: 'deletes service worker chunks that share a merged id with a page chunk',
          issueUrl: 'https://github.com/drptbl/synpress-ngen/issues/1',
        },
      ],
      repository: 'synpress-io/metamask-extension-no-lavamoat',
      timestamp: '2026-08-27T00:00:00.000Z',
    });

    expect(manifest.build.dependencyPatches).toEqual([
      {
        packageName: 'html-bundler-webpack-plugin',
        packageVersion: '4.23.2',
        filePath: 'src/Plugin/Collection.js',
        reason: 'deletes service worker chunks that share a merged id with a page chunk',
        issueUrl: 'https://github.com/drptbl/synpress-ngen/issues/1',
      },
    ]);
  });
});
