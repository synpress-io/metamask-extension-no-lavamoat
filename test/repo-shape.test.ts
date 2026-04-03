import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('repo foundation', () => {
  it('has the core builder surfaces', () => {
    const required = [
      'README.md',
      'docs/reference/release-contract.md',
      'docs/reference/config-extraction.md',
      'docs/reference/operations.md',
      'src/lib/contracts.ts',
      'src/lib/errors.ts',
    ];

    for (const relative of required) {
      expect(existsSync(relative), `${relative} should exist`).toBe(true);
    }
  });
});
