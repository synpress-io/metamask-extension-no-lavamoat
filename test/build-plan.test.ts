import { describe, expect, it } from 'vitest';
import { buildCommandFor, buildEnvironment } from '../src/lib/build.js';

describe('buildCommandFor', () => {
  it('builds with webpack in production mode with LavaMoat and Snow disabled', () => {
    expect(buildCommandFor(['chrome'])).toEqual([
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
    ]);
  });

  it('adds a browser flag per requested target', () => {
    expect(buildCommandFor(['chrome', 'firefox'])).toEqual([
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
      '--browser',
      'firefox',
    ]);
  });
});

describe('buildEnvironment', () => {
  it('never leaks INFURA_PROJECT_ID into the build environment', () => {
    // The extension's config precedence is process.env over .metamaskrc, so an
    // inherited INFURA_PROJECT_ID would override the id extracted from the
    // official release. It must be delivered via .metamaskrc only.
    const environment = buildEnvironment({
      INFURA_PROJECT_ID: 'builder-secret',
      PATH: '/usr/bin',
    });

    expect(environment.INFURA_PROJECT_ID).toBeUndefined();
    expect(environment.PATH).toBe('/usr/bin');
  });

  it('appends heap sizing to existing NODE_OPTIONS', () => {
    const environment = buildEnvironment({ NODE_OPTIONS: '--enable-source-maps' });

    expect(environment.NODE_OPTIONS).toMatch(
      /^--enable-source-maps --max-old-space-size=\d+$/,
    );
  });
});
