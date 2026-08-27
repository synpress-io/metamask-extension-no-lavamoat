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

// webpack's chunk-filename runtime (`__webpack_require__.u`) is the only place a
// service worker records the chunks it will `importScripts` at install time. In
// MetaMask's minified production output it reads:
//   `r.u=e=>""+e+"."+({189:"f062d3…",1690:"38d934…"})[e]+".js"`
// The map body is always a flat `id:"hash"` object, so capturing everything
// between the outer braces is safe. Both the arrow and `function` forms are
// accepted so a change of minifier cannot silently disable the check.
const CHUNK_FILENAME_RUNTIME =
  /\.u\s*=\s*(?:\(?\s*[$\w]*\s*\)?\s*=>|function\s*\(\s*[$\w]*\s*\)\s*\{\s*return\s*)[^{]*\{([^{}]*)\}\)?\s*\[\s*[$\w]+\s*\]/;
const CHUNK_FILENAME_ENTRY = /(\d+)\s*:\s*["']([0-9a-f]{6,})["']/g;

// Fallback for chunk filenames written out literally, e.g. an explicit
// `importScripts("./9999.0a2e30dc….js")` outside the runtime map.
const LITERAL_CHUNK_REFERENCE = /["'](?:\.\/)?([\w-]+\.[0-9a-f]{6,}\.js)["']/g;

export interface ServiceWorkerChunkCompletenessInput {
  serviceWorkerSource: string;
  entryNames: string[];
}

export interface ServiceWorkerChunkCompleteness {
  complete: boolean;
  referencedChunkNames: string[];
  missingChunkNames: string[];
}

export interface ArtifactChunkCompleteness extends ServiceWorkerChunkCompleteness {
  artifactName: string;
  serviceWorkerEntryName: string;
}

interface ExtensionManifest {
  manifest_version?: unknown;
  background?: { service_worker?: unknown };
}

/**
 * Reads every chunk filename the service worker can load at runtime.
 *
 * Throws when nothing is recognized: an empty reference set is indistinguishable
 * from the parser no longer matching webpack's output, and reporting "nothing
 * missing" in that case would defeat the whole check.
 */
export function collectServiceWorkerChunkReferences(serviceWorkerSource: string): string[] {
  const references = new Set<string>();
  const runtimeMapBody = CHUNK_FILENAME_RUNTIME.exec(serviceWorkerSource)?.[1];

  if (runtimeMapBody) {
    for (const entry of runtimeMapBody.matchAll(CHUNK_FILENAME_ENTRY)) {
      references.add(`${entry[1]}.${entry[2]}.js`);
    }
  }

  for (const match of serviceWorkerSource.matchAll(LITERAL_CHUNK_REFERENCE)) {
    references.add(match[1] as string);
  }

  if (references.size === 0) {
    throw new UnrecognizedChunkReferencesError();
  }

  return [...references];
}

export function evaluateServiceWorkerChunkCompleteness(
  input: ServiceWorkerChunkCompletenessInput,
): ServiceWorkerChunkCompleteness {
  const referencedChunkNames = collectServiceWorkerChunkReferences(input.serviceWorkerSource);
  const entryNames = new Set(input.entryNames);
  const missingChunkNames = referencedChunkNames.filter((chunkName) => !entryNames.has(chunkName));

  return {
    complete: missingChunkNames.length === 0,
    referencedChunkNames,
    missingChunkNames,
  };
}

export function assertArtifactChunkCompleteness(
  artifactName: string,
  input: ServiceWorkerChunkCompletenessInput,
): ServiceWorkerChunkCompleteness {
  const completeness = evaluateServiceWorkerChunkCompleteness(input);

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
 * Fail-closed release gate: every chunk the packaged service worker loads at
 * install time must exist inside the same artifact. A single absent chunk makes
 * `importScripts` throw, the service worker never activates, and the extension
 * is dead on arrival — which is exactly how v13.45.0-no-lava shipped.
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
    serviceWorkerSource: await readZipEntry(zipPath, serviceWorkerEntryName),
    entryNames,
  });

  return { ...completeness, artifactName, serviceWorkerEntryName };
}
