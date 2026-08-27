import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * The publish CLI verifies chunk completeness on the exact bytes it uploads, so
 * the Chrome asset has to be a real extension zip. `includeChunk: false` builds
 * the artifact shape that shipped as v13.45.0-no-lava.
 */
function writeExtensionZip(sandbox: string, zipPath: string, includeChunk = true): void {
  const stagingDirectory = join(sandbox, 'extension');
  rmSync(stagingDirectory, { force: true, recursive: true });
  mkdirSync(stagingDirectory, { recursive: true });

  writeFileSync(
    join(stagingDirectory, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      version: '13.25.0.0',
      background: { service_worker: 'service-worker.js' },
    }),
    'utf8',
  );
  writeFileSync(
    join(stagingDirectory, 'service-worker.js'),
    'r.u=e=>""+e+"."+({283:"a2e2948b20a4688231c5"})[e]+".js";r.e(283);',
    'utf8',
  );
  if (includeChunk) {
    writeFileSync(
      join(stagingDirectory, '283.a2e2948b20a4688231c5.js'),
      '(globalThis.webpackChunk??=[]).push([[283],{}]);\n',
      'utf8',
    );
  }

  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: stagingDirectory });
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

    const chromeAssetPath = join(sandbox, 'metamask-chrome-13.25.0-no-lava.zip');
    const checksumsPath = join(sandbox, 'SHA256SUMS.txt');
    const manifestPath = join(sandbox, 'release-manifest.json');
    const buildOutputPath = join(sandbox, 'build-output.json');
    const ghLogPath = join(sandbox, 'gh.log');
    const uploadFlagPath = join(sandbox, 'uploaded.flag');
    const ghMockPath = join(sandbox, 'gh');

    const checksumsContents = 'checksums';
    const manifestContents = '{"ok":true}\n';
    writeExtensionZip(sandbox, chromeAssetPath);
    writeFileSync(checksumsPath, checksumsContents, 'utf8');
    writeFileSync(manifestPath, manifestContents, 'utf8');
    writeFileSync(
      buildOutputPath,
      JSON.stringify(
        {
          publishPlan: {
            tag: 'v13.25.0-no-lava',
            title: 'v13.25.0 (No Lava)',
            notes: 'notes',
            assetPaths: [chromeAssetPath, checksumsPath, manifestPath],
          },
        },
        null,
        2,
      ),
      'utf8',
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
      'utf8',
    );
    chmodSync(ghMockPath, 0o755);

    const chromeDigest = sha256(readFileSync(chromeAssetPath));
    const checksumsDigest = sha256(checksumsContents);
    const manifestDigest = sha256(manifestContents);

    const server = createServer((request, response) => {
      if (
        request.url !==
        '/repos/synpress-io/metamask-extension-no-lavamoat/releases/tags/v13.25.0-no-lava'
      ) {
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
                {
                  name: 'metamask-chrome-13.25.0-no-lava.zip',
                  digest: `sha256:${chromeDigest}`,
                },
                { name: 'SHA256SUMS.txt', digest: `sha256:${checksumsDigest}` },
                { name: 'release-manifest.json', digest: `sha256:${manifestDigest}` },
              ]
            : [
                {
                  name: 'metamask-chrome-13.25.0-no-lava.zip',
                  digest: `sha256:${chromeDigest}`,
                },
              ],
        }),
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
            GITHUB_TOKEN: 'test-token',
          },
        },
      );

      const output = JSON.parse(stdout);
      expect(output.created).toBe(false);
      expect(output.repaired).toBe(true);
      expect(output.missingAssetNames).toEqual([]);
      expect(output.artifactVerification).toEqual([
        {
          artifactName: 'metamask-chrome-13.25.0-no-lava.zip',
          serviceWorkerEntryName: 'service-worker.js',
          complete: true,
          runtimes: [
            {
              entryName: 'service-worker.js',
              referencedChunkNames: ['283.a2e2948b20a4688231c5.js'],
            },
          ],
          referencedChunkNames: ['283.a2e2948b20a4688231c5.js'],
          missingChunkNames: [],
        },
      ]);

      const ghLog = readFileSync(ghLogPath, 'utf8');
      expect(ghLog).toContain('release upload v13.25.0-no-lava');
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

  it('refuses to publish an artifact missing a chunk, before touching gh', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mm-publish-cli-'));
    cleanupPaths.push(sandbox);

    const chromeAssetPath = join(sandbox, 'metamask-chrome-13.25.0-no-lava.zip');
    const buildOutputPath = join(sandbox, 'build-output.json');
    const ghLogPath = join(sandbox, 'gh.log');
    const ghMockPath = join(sandbox, 'gh');

    writeExtensionZip(sandbox, chromeAssetPath, false);
    writeFileSync(
      buildOutputPath,
      JSON.stringify({
        publishPlan: {
          tag: 'v13.25.0-no-lava',
          title: 'v13.25.0 (No Lava)',
          notes: 'notes',
          assetPaths: [chromeAssetPath],
        },
      }),
      'utf8',
    );
    writeFileSync(
      ghMockPath,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$GH_LOG_PATH"\nexit 0\n`,
      'utf8',
    );
    chmodSync(ghMockPath, 0o755);

    await expect(
      execFileAsync('node', ['dist/cli/publish-release.js', '--build-output', buildOutputPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_BIN: ghMockPath,
          GH_LOG_PATH: ghLogPath,
          GITHUB_REPOSITORY: 'synpress-io/metamask-extension-no-lavamoat',
          GITHUB_TOKEN: 'test-token',
        },
      }),
    ).rejects.toThrow(/283\.a2e2948b20a4688231c5\.js/);

    // The gate must run before any release mutation: gh is never invoked, so the
    // mock never creates its log.
    expect(existsSync(ghLogPath)).toBe(false);
  });

  it('refuses to publish a release that carries no inspectable artifact', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mm-publish-cli-'));
    cleanupPaths.push(sandbox);

    const notesPath = join(sandbox, 'release-manifest.json');
    const buildOutputPath = join(sandbox, 'build-output.json');
    const ghLogPath = join(sandbox, 'gh.log');
    const ghMockPath = join(sandbox, 'gh');

    writeFileSync(notesPath, '{"ok":true}\n', 'utf8');
    writeFileSync(
      buildOutputPath,
      JSON.stringify({
        publishPlan: {
          tag: 'v13.25.0-no-lava',
          title: 'v13.25.0 (No Lava)',
          notes: 'notes',
          assetPaths: [notesPath],
        },
      }),
      'utf8',
    );
    writeFileSync(
      ghMockPath,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$GH_LOG_PATH"\nexit 0\n`,
      'utf8',
    );
    chmodSync(ghMockPath, 0o755);

    // Without this the gate silently becomes a no-op the moment the Chrome asset
    // stops matching the shape it filters on.
    await expect(
      execFileAsync('node', ['dist/cli/publish-release.js', '--build-output', buildOutputPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_BIN: ghMockPath,
          GH_LOG_PATH: ghLogPath,
          GITHUB_REPOSITORY: 'synpress-io/metamask-extension-no-lavamoat',
          GITHUB_TOKEN: 'test-token',
        },
      }),
    ).rejects.toThrow(/no verifiable extension artifact/i);

    expect(existsSync(ghLogPath)).toBe(false);
  });
});
