import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const fixturePath = 'test/fixtures/official-release-payloads/github-release.json';

describe('local cli smoke', () => {
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
