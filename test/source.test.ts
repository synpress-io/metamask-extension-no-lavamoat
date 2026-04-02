import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeSourceGitMetadata } from '../src/lib/source.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, { force: true, recursive: true });
  }
});

describe('initializeSourceGitMetadata', () => {
  it('creates a repository with a HEAD commit for upstream builds that require git metadata', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'mm-source-git-test-'));
    temporaryDirectories.push(sourceDir);

    await initializeSourceGitMetadata(sourceDir, 'v13.25.0');

    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sourceDir,
      encoding: 'utf8'
    }).trim();

    expect(revision).toMatch(/^[0-9a-f]{40}$/);
  });
});
