import { describe, expect, it } from 'vitest';
import { buildCommandFor } from '../src/lib/build.js';

describe('buildCommandFor', () => {
  it('uses official source and disables LavaMoat', () => {
    expect(buildCommandFor({ buildTarget: 'dist' })).toEqual([
      'node',
      'development/build/index.js',
      'dist',
      '--apply-lavamoat=false',
      '--snow=false'
    ]);
  });
});
