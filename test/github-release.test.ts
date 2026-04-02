import { describe, expect, it } from 'vitest';
import { buildGitHubReleasePublishPlan } from '../src/lib/github-release.js';

describe('buildGitHubReleasePublishPlan', () => {
  it('creates the builder release tag and upload asset list', () => {
    const plan = buildGitHubReleasePublishPlan({
      upstreamTag: 'v13.25.0',
      assetPaths: [
        '/tmp/metamask-chrome-13.25.0-no-lavamoat.zip',
        '/tmp/SHA256SUMS.txt',
        '/tmp/release-manifest.json'
      ]
    });

    expect(plan.tag).toBe('v13.25.0-no-lavamoat');
    expect(plan.title).toBe('v13.25.0 (No LavaMoat)');
    expect(plan.assetPaths).toEqual([
      '/tmp/metamask-chrome-13.25.0-no-lavamoat.zip',
      '/tmp/SHA256SUMS.txt',
      '/tmp/release-manifest.json'
    ]);
  });
});
