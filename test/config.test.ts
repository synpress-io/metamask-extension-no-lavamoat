import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AmbiguousConfigError, MissingSecretFallbackError } from '../src/lib/errors.js';
import { resolveBuildConfig, resolveBuildConfigFromOfficialReleaseZip } from '../src/lib/config.js';

const temporaryPaths: string[] = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop() as string, { force: true, recursive: true });
  }
});

describe('resolveBuildConfig', () => {
  it('prefers values extracted from the official release zip', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: ["var infuraProjectId = '0123456789abcdef0123456789abcdef';"],
      secretInfuraProjectId: 'fallback'
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });

  it('falls back to the secret only when extraction fails cleanly', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: [],
      secretInfuraProjectId: 'fallback'
    });

    expect(config.infuraProjectId).toBe('fallback');
    expect(config.source).toBe('secret-fallback');
  });

  it('throws when multiple candidate values are present', () => {
    expect(() =>
      resolveBuildConfig({
        extractedReleaseFiles: [
          "var infuraProjectId = '0123456789abcdef0123456789abcdef';",
          "var infuraProjectId = 'fedcba98765432100123456789abcdef';"
        ],
        secretInfuraProjectId: 'fallback'
      })
    ).toThrow(AmbiguousConfigError);
  });

  it('throws when there is no extracted value and no fallback secret', () => {
    expect(() =>
      resolveBuildConfig({
        extractedReleaseFiles: [],
        secretInfuraProjectId: undefined
      })
    ).toThrow(MissingSecretFallbackError);
  });
});

describe('resolveBuildConfigFromOfficialReleaseZip', () => {
  it('scans the official release zip for the Infura project id', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mm-config-test-'));
    const zipPath = join(workspace, 'official-release.zip');
    temporaryPaths.push(workspace);

    writeFileSync(
      join(workspace, 'background.js'),
      "window.__config = {}; var infuraProjectId = '0123456789abcdef0123456789abcdef';\n",
      'utf8'
    );

    execFileSync('zip', ['-q', zipPath, 'background.js'], {
      cwd: workspace
    });

    const config = await resolveBuildConfigFromOfficialReleaseZip({
      zipPath,
      secretInfuraProjectId: 'fallback'
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });
});
