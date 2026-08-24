import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBuildConfig, resolveBuildConfigFromOfficialReleaseZip } from '../src/lib/config.js';
import { AmbiguousConfigError, MissingExtractedConfigError } from '../src/lib/errors.js';

const temporaryPaths: string[] = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop() as string, { force: true, recursive: true });
  }
});

describe('resolveBuildConfig', () => {
  it('extracts the Infura project id from an assignment expression', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: ["var infuraProjectId = '0123456789abcdef0123456789abcdef';"],
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });

  it('extracts the Infura project id from the current compiled MetaMask fallback expression', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: [
        'globalThis.INFURA_PROJECT_ID=a??"0123456789abcdef0123456789abcdef";',
        'const infuraProjectId=globalThis.INFURA_PROJECT_ID??"0123456789abcdef0123456789abcdef";',
      ],
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });

  it('extracts the Infura project id from verbatim webpack-built official bundles (v13.42.0+)', () => {
    // Minified statements captured from the official metamask-chrome-13.45.0.zip,
    // with the project id replaced by a placeholder of identical shape.
    const config = resolveBuildConfig({
      extractedReleaseFiles: [
        ';var e=__webpack_require__(108120);let t=(0,e.P)().testing?.infuraProjectId;globalThis.INFURA_PROJECT_ID=t??"0123456789abcdef0123456789abcdef"}}).call(__webpack_exports__)',
        'let U=globalThis.INFURA_PROJECT_ID??"0123456789abcdef0123456789abcdef";let G=({network:e,excludeProjectId:t=!1})=>{}',
      ],
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });

  it('does not cross a statement boundary while scanning for compiled fallback expressions', () => {
    const config = resolveBuildConfig({
      extractedReleaseFiles: [
        'globalThis.INFURA_PROJECT_ID=testingConfig.infuraProjectId;const otherConfig=foo??"fedcba98765432100123456789abcdef";',
        'const infuraProjectId=globalThis.INFURA_PROJECT_ID??"0123456789abcdef0123456789abcdef";',
      ],
    });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });

  it('throws when multiple candidate values are present', () => {
    expect(() =>
      resolveBuildConfig({
        extractedReleaseFiles: [
          "var infuraProjectId = '0123456789abcdef0123456789abcdef';",
          "var infuraProjectId = 'fedcba98765432100123456789abcdef';",
        ],
      }),
    ).toThrow(AmbiguousConfigError);
  });

  it('throws when no value can be extracted from the official release', () => {
    expect(() =>
      resolveBuildConfig({
        extractedReleaseFiles: [],
      }),
    ).toThrow(MissingExtractedConfigError);
  });
});

describe('resolveBuildConfigFromOfficialReleaseZip', () => {
  it('scans the official release zip for the Infura project id', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mm-config-test-'));
    const zipPath = join(workspace, 'official-release.zip');
    temporaryPaths.push(workspace);

    writeFileSync(
      join(workspace, 'background.js'),
      [
        'const testingConfig = {};',
        'globalThis.INFURA_PROJECT_ID=testingConfig.infuraProjectId??"0123456789abcdef0123456789abcdef";',
        'const infuraProjectId=globalThis.INFURA_PROJECT_ID??"0123456789abcdef0123456789abcdef";',
      ].join('\n'),
      'utf8',
    );

    execFileSync('zip', ['-q', zipPath, 'background.js'], {
      cwd: workspace,
    });

    const config = await resolveBuildConfigFromOfficialReleaseZip({ zipPath });

    expect(config.infuraProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(config.source).toBe('official-release');
  });
});
