import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('biome contract', () => {
  it('defines biome as the single lint and formatting tool', () => {
    expect(existsSync('biome.jsonc')).toBe(true);

    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.devDependencies?.['@biomejs/biome']).toBe('2.4.10');
    expect(packageJson.scripts?.lint).toBe('biome lint .');
    expect(packageJson.scripts?.format).toBe('biome format --write .');
    expect(packageJson.scripts?.check).toBe('biome check --write .');
    expect(packageJson.scripts?.['check:ci']).toBe('biome ci .');
  });

  it('enforces biome in CI before typecheck', () => {
    const workflow = readFileSync('.github/workflows/test.yml', 'utf8');

    expect(workflow).toContain('pnpm run check:ci');
    expect(workflow.indexOf('pnpm run check:ci')).toBeLessThan(
      workflow.indexOf('pnpm run typecheck'),
    );
  });
});
