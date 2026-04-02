import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const fixturePath = 'test/fixtures/official-release-payloads/github-release.json';

describe('local cli smoke', () => {
  it('resolves the latest upstream tag from a fixture payload', () => {
    const stdout = execFileSync(
      'node',
      ['dist/cli/resolve-upstream-tag.js', '--fixture-release', fixturePath],
      { encoding: 'utf8' }
    );

    expect(stdout).toBe('v13.25.0');
  });

  it('renders an upstream release decision from a fixture payload', () => {
    const stdout = execFileSync(
      'node',
      [
        'dist/cli/check-for-upstream-release.js',
        '--dry-run',
        '--tag',
        'v13.25.0',
        '--fixture-release',
        fixturePath,
        '--builder-release-exists',
        'false'
      ],
      { encoding: 'utf8' }
    );

    const output = JSON.parse(stdout);
    expect(output.upstreamTag).toBe('v13.25.0');
    expect(output.builderReleaseTag).toBe('v13.25.0-no-lavamoat');
    expect(output.shouldBuild).toBe(true);
  });

  it('keeps the fixture-backed release decision aligned with asset completeness checks', () => {
    const stdout = execFileSync(
      'node',
      [
        'dist/cli/check-for-upstream-release.js',
        '--dry-run',
        '--tag',
        'v13.25.0',
        '--fixture-release',
        fixturePath,
        '--builder-release-exists',
        'true',
        '--builder-release-assets',
        'metamask-chrome-13.25.0-no-lavamoat.zip'
      ],
      { encoding: 'utf8' }
    );

    const output = JSON.parse(stdout);
    expect(output.builderReleaseExists).toBe(true);
    expect(output.builderReleaseComplete).toBe(false);
    expect(output.shouldBuild).toBe(true);
    expect(output.missingBuilderAssets).toEqual(['SHA256SUMS.txt', 'release-manifest.json']);
  });

  it('can force a rebuild for a fixture-backed release that fails integrity validation', () => {
    const stdout = execFileSync(
      'node',
      [
        'dist/cli/check-for-upstream-release.js',
        '--dry-run',
        '--tag',
        'v13.25.0',
        '--fixture-release',
        fixturePath,
        '--builder-release-exists',
        'true',
        '--builder-release-assets',
        'metamask-chrome-13.25.0-no-lavamoat.zip,SHA256SUMS.txt,release-manifest.json',
        '--builder-release-integrity-valid',
        'false'
      ],
      { encoding: 'utf8' }
    );

    const output = JSON.parse(stdout);
    expect(output.builderReleaseComplete).toBe(true);
    expect(output.builderReleaseIntegrityValid).toBe(false);
    expect(output.shouldBuild).toBe(true);
  });

  it('renders a dry-run build plan from a fixture payload', () => {
    const stdout = execFileSync(
      'node',
      [
        'dist/cli/build-release.js',
        '--dry-run',
        '--tag',
        'v13.25.0',
        '--fixture-release',
        fixturePath
      ],
      { encoding: 'utf8' }
    );

    const output = JSON.parse(stdout);
    expect(output.upstreamTag).toBe('v13.25.0');
    expect(output.builderReleaseTag).toBe('v13.25.0-no-lavamoat');
    expect(output.buildCommand).toEqual([
      'node',
      'development/build/index.js',
      'dist',
      '--apply-lavamoat=false',
      '--snow=false'
    ]);
  });
});
