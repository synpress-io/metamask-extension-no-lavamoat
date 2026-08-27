import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DependencyPatchAnchorMissingError } from './errors.js';

export interface DependencyPatch {
  packageName: string;
  /** Path inside the installed package, relative to the package root. */
  filePath: string;
  /** Verbatim source that must be present before patching. */
  anchor: string;
  replacement: string;
  /** Substring that only ever appears in patched source. */
  appliedMarker: string;
  reason: string;
  issueUrl: string;
}

export interface AppliedDependencyPatch {
  packageName: string;
  packageVersion: string;
  filePath: string;
  reason: string;
  issueUrl: string;
}

// html-bundler-webpack-plugin's "remove generated unused split chunks" pass
// matches chunks by chunk-id intersection with the ids of the HTML pages'
// entrypoint chunks, but then deletes by FILE. webpack merges duplicate chunks
// across runtimes, so MetaMask's service-worker chunk carries a second id that
// belongs to a page chunk (`[1690, 8717]`, where 8717 is the pages'
// vendor-24e2b4df chunk), and the plugin deletes the service worker's only copy
// of it. `__webpack_require__.u` was written long before, so the packaged
// service worker still imports a file that no longer exists and the extension
// never boots. LavaMoat-enabled official builds partition chunks differently and
// never collide, which is why only --no-lavamoat builds are affected.
//
// The correction keeps the pass's intent — drop split chunks generated for HTML
// pages that were never injected into one — but decides membership by filename
// in the pages' own chunk groups rather than by an id that another runtime can
// legitimately share. The anchor is matched verbatim: a plugin release that
// changes this block must fail the build rather than silently build unpatched.
export const HTML_BUNDLER_SPLIT_CHUNK_PATCH: DependencyPatch = {
  packageName: 'html-bundler-webpack-plugin',
  filePath: 'src/Plugin/Collection.js',
  anchor: `    const chunkIds = Array.from(splitChunkIds);

    // remove generated unused split chunks
    for (let { ids, files, chunkReason } of chunks) {
      const isSplitChunk = chunkReason != null && chunkReason.indexOf('split') > -1;

      if (ids.length === 0 || !isSplitChunk) continue;

      for (let file of files) {
        if (splitChunkFiles.has(file)) continue;

        if (chunkIds.find((id) => ids.indexOf(id) > -1)) {
          this.assetTrash.add(file);
        }
      }
    }`,
  replacement: `    // PATCHED by synpress-io/metamask-extension-no-lavamoat: upstream matches by
    // chunk id but deletes by file, so a chunk that carries a second id merged in
    // from another runtime loses its only file. Decide membership by filename in
    // the HTML entries' own chunk groups instead.
    const entrypointChunkFiles = new Set();

    for (const [, entrypointAsset] of this.assets) {
      if (entrypointAsset.type !== Collection.type.script) continue;

      const entrypointGroup = namedChunkGroups.get(entrypointAsset.name);
      if (!entrypointGroup) continue;

      for (const entrypointChunk of entrypointGroup.chunks) {
        for (const entrypointFile of entrypointChunk.files) {
          entrypointChunkFiles.add(entrypointFile);
        }
      }
    }

    // remove generated unused split chunks
    for (let { ids, files, chunkReason } of chunks) {
      const isSplitChunk = chunkReason != null && chunkReason.indexOf('split') > -1;

      if (ids.length === 0 || !isSplitChunk) continue;

      for (let file of files) {
        if (splitChunkFiles.has(file)) continue;

        if (entrypointChunkFiles.has(file)) {
          this.assetTrash.add(file);
        }
      }
    }`,
  appliedMarker: 'PATCHED by synpress-io/metamask-extension-no-lavamoat',
  reason:
    'Collection#prepareScriptData deletes a split chunk by filename after matching it by chunk id, dropping service-worker chunks that share a merged id with an HTML page chunk',
  issueUrl: 'https://github.com/drptbl/synpress-ngen/issues/1',
};

export const REQUIRED_DEPENDENCY_PATCHES: DependencyPatch[] = [HTML_BUNDLER_SPLIT_CHUNK_PATCH];

/**
 * Applies one patch to a source file's contents.
 *
 * Fail-closed on purpose: an unmatched anchor means the dependency changed under
 * us, and building unpatched would silently reintroduce the defect the patch
 * exists to prevent. Already-patched input is returned untouched so the step is
 * idempotent.
 */
export function applyDependencyPatch(source: string, patch: DependencyPatch): string {
  if (source.includes(patch.anchor)) {
    return source.replace(patch.anchor, patch.replacement);
  }

  if (source.includes(patch.appliedMarker)) {
    return source;
  }

  throw new DependencyPatchAnchorMissingError(patch.packageName, patch.filePath);
}

async function readPackageVersion(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
  };

  return typeof manifest.version === 'string' ? manifest.version : 'unknown';
}

/**
 * Patches build-time dependencies inside an installed MetaMask workspace.
 *
 * Returns the provenance record recorded in the release manifest, so a published
 * artifact always states which dependency it was built with a correction to.
 */
export async function applyDependencyPatches(
  sourceDir: string,
  patches: DependencyPatch[] = REQUIRED_DEPENDENCY_PATCHES,
): Promise<AppliedDependencyPatch[]> {
  const applied: AppliedDependencyPatch[] = [];

  for (const patch of patches) {
    const packageRoot = join(sourceDir, 'node_modules', patch.packageName);
    const targetPath = join(packageRoot, patch.filePath);
    const source = await readFile(targetPath, 'utf8');

    await writeFile(targetPath, applyDependencyPatch(source, patch), 'utf8');

    applied.push({
      packageName: patch.packageName,
      packageVersion: await readPackageVersion(packageRoot),
      filePath: patch.filePath,
      reason: patch.reason,
      issueUrl: patch.issueUrl,
    });
  }

  return applied;
}
