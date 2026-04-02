import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workflow contracts', () => {
  it('defines the expected workflows and entrypoints', () => {
    const workflows = [
      '.github/workflows/monitor-releases.yml',
      '.github/workflows/build-release.yml',
      '.github/workflows/test.yml'
    ];

    for (const workflow of workflows) {
      expect(existsSync(workflow), `${workflow} should exist`).toBe(true);
    }

    expect(readFileSync('.github/workflows/monitor-releases.yml', 'utf8')).toContain('node dist/cli/check-for-upstream-release.js');
    expect(readFileSync('.github/workflows/build-release.yml', 'utf8')).toContain('node dist/cli/build-release.js');
    expect(readFileSync('.github/workflows/test.yml', 'utf8')).toContain('pnpm run typecheck');
  });
});
