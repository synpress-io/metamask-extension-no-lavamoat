import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDependencyPatch,
  applyDependencyPatches,
  HTML_BUNDLER_SPLIT_CHUNK_PATCH,
  REQUIRED_DEPENDENCY_PATCHES,
} from '../src/lib/dependency-patch.js';
import { DependencyPatchAnchorMissingError } from '../src/lib/errors.js';

const temporaryPaths: string[] = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop() as string, { force: true, recursive: true });
  }
});

function installFakePackage(version: string, contents: string): string {
  const sourceDir = mkdtempSync(join(tmpdir(), 'mm-patch-test-'));
  temporaryPaths.push(sourceDir);

  const packageRoot = join(sourceDir, 'node_modules', HTML_BUNDLER_SPLIT_CHUNK_PATCH.packageName);
  const targetPath = join(packageRoot, HTML_BUNDLER_SPLIT_CHUNK_PATCH.filePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version }), 'utf8');
  writeFileSync(targetPath, contents, 'utf8');

  return sourceDir;
}

function patchedTargetPath(sourceDir: string): string {
  return join(
    sourceDir,
    'node_modules',
    HTML_BUNDLER_SPLIT_CHUNK_PATCH.packageName,
    HTML_BUNDLER_SPLIT_CHUNK_PATCH.filePath,
  );
}

describe('applyDependencyPatch', () => {
  it('replaces the anchored upstream block', () => {
    const patched = applyDependencyPatch(
      `header\n${HTML_BUNDLER_SPLIT_CHUNK_PATCH.anchor}\nfooter`,
      HTML_BUNDLER_SPLIT_CHUNK_PATCH,
    );

    expect(patched).toContain(HTML_BUNDLER_SPLIT_CHUNK_PATCH.appliedMarker);
    expect(patched).toContain('entrypointChunkFiles.has(file)');
    // The id-intersection test is what deletes another runtime's chunk.
    expect(patched).not.toContain('chunkIds.find((id) => ids.indexOf(id) > -1)');
    expect(patched).toContain('header');
    expect(patched).toContain('footer');
  });

  it('refuses loudly when the anchored source has changed', () => {
    // A future plugin release must fail the build, never build unpatched: an
    // unpatched build silently reintroduces the missing-chunk defect.
    expect(() =>
      applyDependencyPatch('a completely different implementation', HTML_BUNDLER_SPLIT_CHUNK_PATCH),
    ).toThrow(DependencyPatchAnchorMissingError);
  });

  it('is idempotent on already-patched source', () => {
    const once = applyDependencyPatch(
      HTML_BUNDLER_SPLIT_CHUNK_PATCH.anchor,
      HTML_BUNDLER_SPLIT_CHUNK_PATCH,
    );

    expect(applyDependencyPatch(once, HTML_BUNDLER_SPLIT_CHUNK_PATCH)).toBe(once);
  });

  it('produces syntactically valid javascript', () => {
    const patched = applyDependencyPatch(
      `class Collection {\n  #prepareScriptData() {\n    const chunks = [];\n    const splitChunkIds = new Set();\n    const splitChunkFiles = new Set();\n    const namedChunkGroups = new Map();\n${HTML_BUNDLER_SPLIT_CHUNK_PATCH.anchor}\n  }\n}\n`,
      HTML_BUNDLER_SPLIT_CHUNK_PATCH,
    );
    const workspace = mkdtempSync(join(tmpdir(), 'mm-patch-syntax-'));
    temporaryPaths.push(workspace);
    const scriptPath = join(workspace, 'collection.js');
    writeFileSync(scriptPath, patched, 'utf8');

    expect(() => execFileSync('node', ['--check', scriptPath])).not.toThrow();
  });
});

describe('applyDependencyPatches', () => {
  it('patches the installed package and records it as provenance', async () => {
    const sourceDir = installFakePackage(
      '4.23.2',
      `prefix\n${HTML_BUNDLER_SPLIT_CHUNK_PATCH.anchor}\nsuffix`,
    );

    const applied = await applyDependencyPatches(sourceDir);

    expect(applied).toEqual([
      {
        packageName: 'html-bundler-webpack-plugin',
        packageVersion: '4.23.2',
        filePath: 'src/Plugin/Collection.js',
        reason: HTML_BUNDLER_SPLIT_CHUNK_PATCH.reason,
        issueUrl: HTML_BUNDLER_SPLIT_CHUNK_PATCH.issueUrl,
      },
    ]);
    expect(readFileSync(patchedTargetPath(sourceDir), 'utf8')).toContain(
      HTML_BUNDLER_SPLIT_CHUNK_PATCH.appliedMarker,
    );
  });

  it('refuses to build when a required patch no longer applies', async () => {
    const sourceDir = installFakePackage('5.0.0', 'a rewritten Collection implementation');

    await expect(applyDependencyPatches(sourceDir)).rejects.toThrow(
      DependencyPatchAnchorMissingError,
    );
  });

  it('requires the html-bundler correction on every build', () => {
    expect(REQUIRED_DEPENDENCY_PATCHES).toContain(HTML_BUNDLER_SPLIT_CHUNK_PATCH);
  });
});
