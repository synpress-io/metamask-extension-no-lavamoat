import { describe, expect, it } from 'vitest';
import { buildCommandFor } from '../src/lib/build.js';

describe('buildCommandFor', () => {
  it('builds with webpack in production mode with LavaMoat and Snow disabled', () => {
    expect(buildCommandFor(['chrome'])).toEqual([
      'yarn',
      'webpack',
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
      'yarn',
      'webpack',
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
