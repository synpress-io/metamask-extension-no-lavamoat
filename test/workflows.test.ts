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
      const contents = readFileSync(workflow, 'utf8');
      expect(contents).toContain('actions/checkout@v6');
      expect(contents).toContain('pnpm/action-setup@v5');
      expect(contents).toContain('actions/setup-node@v6');
      expect(contents).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true');
    }

    const monitorWorkflow = readFileSync('.github/workflows/monitor-releases.yml', 'utf8');
    expect(monitorWorkflow).toContain("cron: '0 * * * *'");
    expect(monitorWorkflow).toContain('node dist/cli/check-for-upstream-release.js');
    const buildReleaseWorkflow = readFileSync('.github/workflows/build-release.yml', 'utf8');
    expect(buildReleaseWorkflow).toContain('node dist/cli/build-release.js');
    expect(buildReleaseWorkflow).toContain('node dist/cli/resolve-upstream-tag.js');
    expect(buildReleaseWorkflow).toContain('node dist/cli/check-for-upstream-release.js --tag');
    expect(buildReleaseWorkflow).toContain("should_build == 'true'");
    expect(buildReleaseWorkflow).toContain('node dist/cli/publish-release.js --build-output build-output.json');
    expect(buildReleaseWorkflow).toContain('concurrency:');
    expect(readFileSync('.github/workflows/test.yml', 'utf8')).toContain('pnpm run typecheck');
  });
});
