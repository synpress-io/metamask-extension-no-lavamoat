import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ACTIONS_CHECKOUT_PIN = 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd';
const PNPM_ACTION_SETUP_PIN = 'pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320';
const ACTIONS_SETUP_NODE_PIN = 'actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f';
const ACTIONS_ATTEST_PIN = 'actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26';
const ACTIONS_UPLOAD_ARTIFACT_PIN =
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f';

describe('workflow contracts', () => {
  it('defines the expected workflows and entrypoints', () => {
    const workflows = [
      '.github/workflows/monitor-releases.yml',
      '.github/workflows/build-release.yml',
      '.github/workflows/test.yml',
    ];

    for (const workflow of workflows) {
      expect(existsSync(workflow), `${workflow} should exist`).toBe(true);
      const contents = readFileSync(workflow, 'utf8');
      expect(contents).toContain(ACTIONS_CHECKOUT_PIN);
      expect(contents).toContain(PNPM_ACTION_SETUP_PIN);
      expect(contents).toContain(ACTIONS_SETUP_NODE_PIN);
      expect(contents).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true');
    }

    const monitorWorkflow = readFileSync('.github/workflows/monitor-releases.yml', 'utf8');
    expect(monitorWorkflow).toContain("cron: '0 * * * *'");
    expect(monitorWorkflow).toContain('node dist/cli/check-for-upstream-release.js');
    const buildReleaseWorkflow = readFileSync('.github/workflows/build-release.yml', 'utf8');
    const attestationSubjectPathSnippet = [
      'subject-path: $',
      '{{ steps.release-assets.outputs.attestation_subject_path }}',
    ].join('');
    expect(buildReleaseWorkflow).toContain('node dist/cli/build-release.js');
    expect(buildReleaseWorkflow).toContain('node dist/cli/resolve-upstream-tag.js');
    expect(buildReleaseWorkflow).toContain('node dist/cli/check-for-upstream-release.js --tag');
    expect(buildReleaseWorkflow).toContain("should_build == 'true'");
    expect(buildReleaseWorkflow).toContain('id-token: write');
    expect(buildReleaseWorkflow).toContain('attestations: write');
    expect(buildReleaseWorkflow).toContain('artifact-metadata: write');
    expect(buildReleaseWorkflow).toContain(`uses: ${ACTIONS_ATTEST_PIN}`);
    expect(buildReleaseWorkflow).toContain(`uses: ${ACTIONS_UPLOAD_ARTIFACT_PIN}`);
    expect(buildReleaseWorkflow).toContain(attestationSubjectPathSnippet);
    expect(buildReleaseWorkflow).toContain(
      'node dist/cli/publish-release.js --build-output build-output.json',
    );
    expect(buildReleaseWorkflow).toContain('concurrency:');
    expect(readFileSync('.github/workflows/test.yml', 'utf8')).toContain('pnpm run typecheck');
  });
});
