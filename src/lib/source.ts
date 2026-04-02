import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { UpstreamReleaseRecord } from './upstream.js';

const execFileAsync = promisify(execFile);

export interface PreparedSourceWorkspace {
  rootDir: string;
  sourceDir: string;
  officialChromeReleaseZipPath: string;
  sourceTarballPath: string;
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath));
}

async function extractTarball(tarballPath: string, destinationDirectory: string): Promise<void> {
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', destinationDirectory, '--strip-components=1']);
}

export async function prepareSourceWorkspace(release: UpstreamReleaseRecord): Promise<PreparedSourceWorkspace> {
  const rootDir = await mkdtemp(join(tmpdir(), 'synpress-mm-builder-'));
  const sourceDir = join(rootDir, 'source');

  await mkdir(sourceDir, { recursive: true });

  const officialChromeReleaseZipPath = join(rootDir, basename(new URL(release.chromeZipUrl).pathname));
  const sourceTarballPath = join(rootDir, `${release.version}.tar.gz`);

  await downloadFile(release.chromeZipUrl, officialChromeReleaseZipPath);
  await downloadFile(release.sourceTarballUrl, sourceTarballPath);
  await extractTarball(sourceTarballPath, sourceDir);

  return {
    rootDir,
    sourceDir,
    officialChromeReleaseZipPath,
    sourceTarballPath
  };
}
