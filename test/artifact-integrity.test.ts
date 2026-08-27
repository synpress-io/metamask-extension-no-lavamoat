import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertArtifactChunkCompleteness,
  collectServiceWorkerChunkReferences,
  evaluateServiceWorkerChunkCompleteness,
  verifyArtifactChunkCompleteness,
} from '../src/lib/artifact-integrity.js';
import {
  IncompleteBuiltArtifactError,
  UnrecognizedChunkReferencesError,
  UnsupportedArtifactManifestError,
} from '../src/lib/errors.js';

// Verbatim shape of webpack's `__webpack_require__.u` chunk-filename runtime as
// emitted into service-worker.js by MetaMask's production build, reduced to
// three entries. `1690` is the chunk that v13.45.0-no-lava shipped without.
const CHUNK_FILENAME_RUNTIME =
  'r.u=e=>""+e+"."+({189:"f062d308d0058f2d308d",1690:"38d93430f4639781ca25",283:"a2e2948b20a4688231c5"})[e]+".js",';
const INSTALL_HANDLER =
  'async function a(){await Promise.all([r.e(189),r.e(1690),r.e(283)]).then(r.bind(r,516075))}self.addEventListener("install",a)';
const SERVICE_WORKER_SOURCE = `(()=>{var r={};${CHUNK_FILENAME_RUNTIME}${INSTALL_HANDLER}})();`;

const ALL_CHUNK_NAMES = [
  '189.f062d308d0058f2d308d.js',
  '1690.38d93430f4639781ca25.js',
  '283.a2e2948b20a4688231c5.js',
];

const temporaryPaths: string[] = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop() as string, { force: true, recursive: true });
  }
});

function createArtifactZip(options: {
  chunkNames: string[];
  serviceWorkerSource?: string;
  manifest?: unknown;
}): string {
  const workspace = mkdtempSync(join(tmpdir(), 'mm-artifact-test-'));
  temporaryPaths.push(workspace);

  const stagingDirectory = join(workspace, 'extension');
  mkdirSync(stagingDirectory, { recursive: true });

  writeFileSync(
    join(stagingDirectory, 'manifest.json'),
    JSON.stringify(
      options.manifest ?? {
        manifest_version: 3,
        version: '13.45.0.0',
        background: { service_worker: 'service-worker.js' },
      },
    ),
    'utf8',
  );
  writeFileSync(
    join(stagingDirectory, 'service-worker.js'),
    options.serviceWorkerSource ?? SERVICE_WORKER_SOURCE,
    'utf8',
  );

  for (const chunkName of options.chunkNames) {
    writeFileSync(
      join(stagingDirectory, chunkName),
      '(globalThis.webpackChunk??=[]).push([[0],{}]);\n',
      'utf8',
    );
  }

  const zipPath = join(workspace, 'metamask-chrome-13.45.0-no-lava.zip');
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: stagingDirectory });

  return zipPath;
}

describe('collectServiceWorkerChunkReferences', () => {
  it('reads every chunk name out of the minified chunk-filename runtime', () => {
    expect(collectServiceWorkerChunkReferences(SERVICE_WORKER_SOURCE)).toEqual(
      expect.arrayContaining(ALL_CHUNK_NAMES),
    );
  });

  it('also picks up literal chunk filenames passed to importScripts', () => {
    const source = `${SERVICE_WORKER_SOURCE}importScripts("./9999.0a2e30dcf299dd3b6515.js");`;

    expect(collectServiceWorkerChunkReferences(source)).toContain('9999.0a2e30dcf299dd3b6515.js');
  });

  it('fails closed when the parser recognizes no chunk references at all', () => {
    // A zero-reference result is indistinguishable from parser drift, so it can
    // never be reported as "nothing missing".
    expect(() =>
      collectServiceWorkerChunkReferences('self.addEventListener("install",()=>{});'),
    ).toThrow(UnrecognizedChunkReferencesError);
  });
});

describe('evaluateServiceWorkerChunkCompleteness', () => {
  it('reports a complete artifact when every referenced chunk is present', () => {
    const completeness = evaluateServiceWorkerChunkCompleteness({
      serviceWorkerSource: SERVICE_WORKER_SOURCE,
      entryNames: [...ALL_CHUNK_NAMES, 'manifest.json', 'service-worker.js'],
    });

    expect(completeness.complete).toBe(true);
    expect(completeness.missingChunkNames).toEqual([]);
    expect(completeness.referencedChunkNames).toHaveLength(3);
  });

  it('reports the chunk that v13.45.0-no-lava shipped without', () => {
    const completeness = evaluateServiceWorkerChunkCompleteness({
      serviceWorkerSource: SERVICE_WORKER_SOURCE,
      entryNames: ALL_CHUNK_NAMES.filter((name) => !name.startsWith('1690.')),
    });

    expect(completeness.complete).toBe(false);
    expect(completeness.missingChunkNames).toEqual(['1690.38d93430f4639781ca25.js']);
  });
});

describe('assertArtifactChunkCompleteness', () => {
  it('names every missing chunk in the failure', () => {
    expect(() =>
      assertArtifactChunkCompleteness('metamask-chrome-13.45.0-no-lava.zip', {
        serviceWorkerSource: SERVICE_WORKER_SOURCE,
        entryNames: ['manifest.json', 'service-worker.js'],
      }),
    ).toThrow(/1690\.38d93430f4639781ca25\.js/);
  });

  it('rejects an artifact whose service worker chunks are incomplete', () => {
    expect(() =>
      assertArtifactChunkCompleteness('metamask-chrome-13.45.0-no-lava.zip', {
        serviceWorkerSource: SERVICE_WORKER_SOURCE,
        entryNames: ALL_CHUNK_NAMES.filter((name) => !name.startsWith('1690.')),
      }),
    ).toThrow(IncompleteBuiltArtifactError);
  });

  it('accepts an artifact that carries every referenced chunk', () => {
    expect(
      assertArtifactChunkCompleteness('metamask-chrome-13.45.0-no-lava.zip', {
        serviceWorkerSource: SERVICE_WORKER_SOURCE,
        entryNames: ALL_CHUNK_NAMES,
      }).complete,
    ).toBe(true);
  });
});

describe('verifyArtifactChunkCompleteness', () => {
  it('accepts a built zip that carries every chunk its service worker loads', async () => {
    const zipPath = createArtifactZip({ chunkNames: ALL_CHUNK_NAMES });

    const completeness = await verifyArtifactChunkCompleteness(zipPath);

    expect(completeness.complete).toBe(true);
    expect(completeness.serviceWorkerEntryName).toBe('service-worker.js');
    expect(completeness.referencedChunkNames).toHaveLength(3);
  });

  it('rejects a built zip that is missing a chunk its service worker loads', async () => {
    const zipPath = createArtifactZip({
      chunkNames: ALL_CHUNK_NAMES.filter((name) => !name.startsWith('1690.')),
    });

    await expect(verifyArtifactChunkCompleteness(zipPath)).rejects.toThrow(
      IncompleteBuiltArtifactError,
    );
  });

  it('rejects a built zip whose manifest declares no MV3 service worker', async () => {
    const zipPath = createArtifactZip({
      chunkNames: ALL_CHUNK_NAMES,
      manifest: { manifest_version: 2, version: '13.45.0.0', background: { scripts: ['bg.js'] } },
    });

    await expect(verifyArtifactChunkCompleteness(zipPath)).rejects.toThrow(
      UnsupportedArtifactManifestError,
    );
  });
});
