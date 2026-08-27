import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import {
  IncompleteBuiltArtifactError,
  UnrecognizedChunkReferencesError,
  UnsupportedArtifactManifestError,
} from './errors.js';

const execFileAsync = promisify(execFile);

const EXTENSION_MANIFEST_ENTRY = 'manifest.json';
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const ENTRY_READ_CONCURRENCY = 8;

// webpack's chunk-filename runtime (`__webpack_require__.u`) is where a script
// records the chunks it will load later. In MetaMask's minified production
// output it reads:
//   `r.u=e=>""+e+"."+({189:"f062d3…",1690:"38d934…"})[e]+".js"`
// The map body is always a flat `id:"hash"` object, so capturing everything
// between the outer braces is safe. Both the arrow and `function` forms are
// accepted so a change of minifier cannot silently disable the check.
const CHUNK_FILENAME_RUNTIME =
  /\.u\s*=\s*(?:\(?\s*[$\w]*\s*\)?\s*=>|function\s*\(\s*[$\w]*\s*\)\s*\{\s*return\s*)[^{]*\{([^{}]*)\}\)?\s*\[\s*[$\w]+\s*\]/;
const CHUNK_FILENAME_ENTRY = /(\d+)\s*:\s*["']([0-9a-f]{6,})["']/g;

// Fallback for chunk filenames written out literally, e.g. an explicit
// `importScripts("./9999.0a2e30dc….js")`. Only consulted inside a file that is
// already a recognized chunk-loading runtime: an arbitrary chunk can contain a
// quoted string of the same shape that is not an asset reference at all.
const LITERAL_CHUNK_REFERENCE = /["'](?:\.\/)?([\w-]+\.[0-9a-f]{6,}\.js)["']/g;

export interface ChunkReferenceScan {
  isChunkLoadingRuntime: boolean;
  referencedChunkNames: string[];
}

export interface ChunkLoadingRuntime {
  entryName: string;
  referencedChunkNames: string[];
}

export interface JavascriptEntrySource {
  entryName: string;
  source: string;
}

export interface ArtifactChunkCompletenessInput {
  entryNames: string[];
  javascriptEntries: JavascriptEntrySource[];
}

export interface ChunkCompleteness {
  complete: boolean;
  runtimes: ChunkLoadingRuntime[];
  referencedChunkNames: string[];
  missingChunkNames: string[];
}

export interface ArtifactChunkCompleteness extends ChunkCompleteness {
  artifactName: string;
  serviceWorkerEntryName: string;
}

interface ExtensionManifest {
  manifest_version?: unknown;
  background?: { service_worker?: unknown };
}

/**
 * Reads the chunk filenames one packaged script can load at runtime.
 *
 * Never throws: a single file that is not a chunk-loading runtime is the normal
 * case, and only the artifact-wide result can tell "nothing to load" apart from
 * "the parser no longer matches webpack's output".
 */
export function collectChunkReferences(source: string): ChunkReferenceScan {
  const runtimeMapBody = CHUNK_FILENAME_RUNTIME.exec(source)?.[1];

  if (runtimeMapBody === undefined) {
    return { isChunkLoadingRuntime: false, referencedChunkNames: [] };
  }

  const references = new Set<string>();

  for (const entry of runtimeMapBody.matchAll(CHUNK_FILENAME_ENTRY)) {
    references.add(`${entry[1]}.${entry[2]}.js`);
  }

  for (const match of source.matchAll(LITERAL_CHUNK_REFERENCE)) {
    references.add(match[1] as string);
  }

  return { isChunkLoadingRuntime: true, referencedChunkNames: [...references] };
}

/**
 * Unions the chunk references of every chunk-loading runtime in the artifact.
 *
 * An extension has more than one: MetaMask packages a service-worker runtime and
 * a separate UI runtime, and a chunk lost from either one breaks the surfaces
 * that depend on it. Recognizing no runtime at all is indistinguishable from
 * parser drift and fails closed.
 */
export function evaluateArtifactChunkCompleteness(
  input: ArtifactChunkCompletenessInput,
): ChunkCompleteness {
  const runtimes: ChunkLoadingRuntime[] = [];

  for (const entry of input.javascriptEntries) {
    const scan = collectChunkReferences(entry.source);

    if (scan.isChunkLoadingRuntime) {
      runtimes.push({
        entryName: entry.entryName,
        referencedChunkNames: scan.referencedChunkNames,
      });
    }
  }

  if (runtimes.length === 0) {
    throw new UnrecognizedChunkReferencesError();
  }

  const referencedChunkNames = [
    ...new Set(runtimes.flatMap((runtime) => runtime.referencedChunkNames)),
  ];
  const entryNames = new Set(input.entryNames);
  const missingChunkNames = referencedChunkNames.filter((chunkName) => !entryNames.has(chunkName));

  return {
    complete: missingChunkNames.length === 0,
    runtimes,
    referencedChunkNames,
    missingChunkNames,
  };
}

export function assertArtifactChunkCompleteness(
  artifactName: string,
  input: ArtifactChunkCompletenessInput,
): ChunkCompleteness {
  const completeness = evaluateArtifactChunkCompleteness(input);

  if (!completeness.complete) {
    throw new IncompleteBuiltArtifactError(artifactName, completeness.missingChunkNames);
  }

  return completeness;
}

async function readZipEntryNames(zipPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath], {
    encoding: 'utf8',
    maxBuffer: MAX_ENTRY_BYTES,
  });

  return stdout
    .split('\n')
    .map((entryName) => entryName.trim())
    .filter((entryName) => entryName.length > 0);
}

async function readZipEntry(zipPath: string, entryName: string): Promise<string> {
  const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entryName], {
    encoding: 'utf8',
    maxBuffer: MAX_ENTRY_BYTES,
  });

  return stdout;
}

async function readJavascriptEntries(
  zipPath: string,
  entryNames: string[],
): Promise<JavascriptEntrySource[]> {
  const pending = entryNames.filter((entryName) => entryName.endsWith('.js'));
  const sources: JavascriptEntrySource[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const entryName = pending[cursor] as string;
      cursor += 1;
      sources.push({ entryName, source: await readZipEntry(zipPath, entryName) });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ENTRY_READ_CONCURRENCY, pending.length) }, worker),
  );

  return sources;
}

function resolveServiceWorkerEntryName(artifactName: string, manifestSource: string): string {
  let manifest: ExtensionManifest;

  try {
    manifest = JSON.parse(manifestSource) as ExtensionManifest;
  } catch {
    throw new UnsupportedArtifactManifestError(
      artifactName,
      `${EXTENSION_MANIFEST_ENTRY} is not valid JSON`,
    );
  }

  if (manifest.manifest_version !== 3) {
    throw new UnsupportedArtifactManifestError(
      artifactName,
      `expected manifest_version 3, found ${JSON.stringify(manifest.manifest_version)}`,
    );
  }

  const serviceWorkerEntryName = manifest.background?.service_worker;

  if (typeof serviceWorkerEntryName !== 'string' || serviceWorkerEntryName.length === 0) {
    throw new UnsupportedArtifactManifestError(
      artifactName,
      'background.service_worker is missing',
    );
  }

  return serviceWorkerEntryName;
}

/**
 * Fail-closed release gate: every chunk any packaged runtime can load must exist
 * inside the same artifact. A single absent chunk makes the loading script throw
 * — for the service worker that means it never activates and the extension is
 * dead on arrival, which is exactly how v13.45.0-no-lava shipped.
 */
export async function verifyArtifactChunkCompleteness(
  zipPath: string,
): Promise<ArtifactChunkCompleteness> {
  const artifactName = basename(zipPath);
  const entryNames = await readZipEntryNames(zipPath);

  if (!entryNames.includes(EXTENSION_MANIFEST_ENTRY)) {
    throw new UnsupportedArtifactManifestError(
      artifactName,
      `${EXTENSION_MANIFEST_ENTRY} is missing`,
    );
  }

  const serviceWorkerEntryName = resolveServiceWorkerEntryName(
    artifactName,
    await readZipEntry(zipPath, EXTENSION_MANIFEST_ENTRY),
  );

  if (!entryNames.includes(serviceWorkerEntryName)) {
    throw new UnsupportedArtifactManifestError(
      artifactName,
      `background.service_worker ${serviceWorkerEntryName} is missing`,
    );
  }

  const completeness = assertArtifactChunkCompleteness(artifactName, {
    entryNames,
    javascriptEntries: await readJavascriptEntries(zipPath, entryNames),
  });

  return { ...completeness, artifactName, serviceWorkerEntryName };
}
