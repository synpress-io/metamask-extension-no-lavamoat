import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { force: true, recursive: true });
    }
  }
});

describe('publish-release cli', () => {
  it('repairs an existing incomplete release through the CLI path', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mm-publish-cli-'));
    cleanupPaths.push(sandbox);

    const chromeAssetPath = join(sandbox, 'metamask-chrome-13.25.0-no-lavamoat.zip');
    const checksumsPath = join(sandbox, 'SHA256SUMS.txt');
    const manifestPath = join(sandbox, 'release-manifest.json');
    const buildOutputPath = join(sandbox, 'build-output.json');
    const ghLogPath = join(sandbox, 'gh.log');
    const uploadFlagPath = join(sandbox, 'uploaded.flag');
    const ghMockPath = join(sandbox, 'gh');

    const chromeContents = 'zip-content';
    const checksumsContents = 'checksums';
    const manifestContents = '{"ok":true}\n';
    writeFileSync(chromeAssetPath, chromeContents, 'utf8');
    writeFileSync(checksumsPath, checksumsContents, 'utf8');
    writeFileSync(manifestPath, manifestContents, 'utf8');
    writeFileSync(
      buildOutputPath,
      JSON.stringify(
        {
          publishPlan: {
            tag: 'v13.25.0-no-lavamoat',
            title: 'v13.25.0 (No LavaMoat)',
            notes: 'notes',
            assetPaths: [chromeAssetPath, checksumsPath, manifestPath]
          }
        },
        null,
        2
      ),
      'utf8'
    );

    writeFileSync(
      ghMockPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_LOG_PATH"
if [ "$1" = "release" ] && [ "$2" = "upload" ]; then
  touch "$GH_UPLOAD_FLAG"
  exit 0
fi
if [ "$1" = "release" ] && [ "$2" = "create" ]; then
  echo "create should not be called" >&2
  exit 1
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
      'utf8'
    );
    chmodSync(ghMockPath, 0o755);

    const chromeDigest = sha256(chromeContents);
    const checksumsDigest = sha256(checksumsContents);
    const manifestDigest = sha256(manifestContents);

    const server = createServer((request, response) => {
      if (request.url !== '/repos/synpress-io/metamask-extension-no-lavamoat/releases/tags/v13.25.0-no-lavamoat') {
        response.statusCode = 404;
        response.end('not found');
        return;
      }

      const uploaded = (() => {
        try {
          readFileSync(uploadFlagPath, 'utf8');
          return true;
        } catch {
          return false;
        }
      })();

      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          assets: uploaded
            ? [
                { name: 'metamask-chrome-13.25.0-no-lavamoat.zip', digest: `sha256:${chromeDigest}` },
                { name: 'SHA256SUMS.txt', digest: `sha256:${checksumsDigest}` },
                { name: 'release-manifest.json', digest: `sha256:${manifestDigest}` }
              ]
            : [{ name: 'metamask-chrome-13.25.0-no-lavamoat.zip', digest: `sha256:${chromeDigest}` }]
        })
      );
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('expected an addressable local server');
      }

      const { stdout } = await execFileAsync(
        'node',
        ['dist/cli/publish-release.js', '--build-output', buildOutputPath],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            GH_BIN: ghMockPath,
            GH_LOG_PATH: ghLogPath,
            GH_UPLOAD_FLAG: uploadFlagPath,
            GITHUB_API_BASE_URL: `http://127.0.0.1:${address.port}`,
            GITHUB_REPOSITORY: 'synpress-io/metamask-extension-no-lavamoat',
            GITHUB_TOKEN: 'test-token'
          }
        }
      );

      const output = JSON.parse(stdout);
      expect(output.created).toBe(false);
      expect(output.repaired).toBe(true);
      expect(output.missingAssetNames).toEqual([]);

      const ghLog = readFileSync(ghLogPath, 'utf8');
      expect(ghLog).toContain('release upload v13.25.0-no-lavamoat');
      expect(ghLog).toContain(checksumsPath);
      expect(ghLog).toContain(manifestPath);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
