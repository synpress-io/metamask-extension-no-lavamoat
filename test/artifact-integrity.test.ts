import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertArtifactChunkCompleteness,
  collectChunkReferences,
  evaluateArtifactChunkCompleteness,
  verifyArtifactChunkCompleteness,
} from '../src/lib/artifact-integrity.js';
import {
  IncompleteBuiltArtifactError,
  UnrecognizedChunkReferencesError,
  UnsupportedArtifactManifestError,
} from '../src/lib/errors.js';

// Verbatim shape of webpack's `__webpack_require__.u` chunk-filename runtime as
// emitted by MetaMask's production build, reduced to a few entries. `1690` is
// the chunk that v13.45.0-no-lava shipped without.
const SERVICE_WORKER_CHUNKS = ['189.f062d308d0058f2d308d.js', '1690.38d93430f4639781ca25.js'];
const UI_RUNTIME_CHUNKS = ['283.a2e2948b20a4688231c5.js', '9828.ce4b1c55046a8be22274.js'];

const SERVICE_WORKER_SOURCE =
  '(()=>{var r={};r.u=e=>""+e+"."+({189:"f062d308d0058f2d308d",1690:"38d93430f4639781ca25"})[e]+".js",' +
  'async function a(){await Promise.all([r.e(189),r.e(1690)])}self.addEventListener("install",a)})();';

// MetaMask packages a second chunk-loading runtime for every extension page.
const UI_RUNTIME_SOURCE =
  '(()=>{var n={};n.u=t=>""+t+"."+({283:"a2e2948b20a4688231c5",9828:"ce4b1c55046a8be22274"})[t]+".js"})();';

// An ordinary chunk: no chunk-filename runtime, but it does contain a quoted
// string shaped exactly like a chunk filename.
const PLAIN_CHUNK_SOURCE =
  '(globalThis.webpackChunk??=[]).push([[283],{404:e=>{e.exports="7777.deadbeefdeadbeefdead.js"}}]);';

const temporaryPaths: string[] = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop() as string, { force: true, recursive: true });
  }
});

function javascriptEntries(chunkNames: string[]) {
  return [
    { entryName: 'service-worker.js', source: SERVICE_WORKER_SOURCE },
    { entryName: 'runtime.abc123abc123abc123ab.js', source: UI_RUNTIME_SOURCE },
    ...chunkNames.map((entryName) => ({ entryName, source: PLAIN_CHUNK_SOURCE })),
  ];
}

function createArtifactZip(options: { chunkNames: string[]; manifest?: unknown }): string {
  const workspace = mkdtempSync(join(tmpdir(), 'mm-artifact-test-'));
  temporaryPaths.push(workspace);

  const stagingDirectory = join(workspace, 'extension');
  mkdirSync(stagingDirectory, { recursive: true });

  writeFileSync(
    join(stagingDirectory, 'manifest.json'),
    JSON.stringify(
      options.manifest ?? {
        manifest_version: 3,
        version: '13.45.1.0',
        background: { service_worker: 'service-worker.js' },
      },
    ),
    'utf8',
  );
  writeFileSync(join(stagingDirectory, 'service-worker.js'), SERVICE_WORKER_SOURCE, 'utf8');
  writeFileSync(
    join(stagingDirectory, 'runtime.abc123abc123abc123ab.js'),
    UI_RUNTIME_SOURCE,
    'utf8',
  );

  for (const chunkName of options.chunkNames) {
    writeFileSync(join(stagingDirectory, chunkName), PLAIN_CHUNK_SOURCE, 'utf8');
  }

  const zipPath = join(workspace, 'metamask-chrome-13.45.1-no-lava.zip');
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: stagingDirectory });

  return zipPath;
}

describe('collectChunkReferences', () => {
  it('reads every chunk name out of a minified chunk-filename runtime', () => {
    const scan = collectChunkReferences(SERVICE_WORKER_SOURCE);

    expect(scan.isChunkLoadingRuntime).toBe(true);
    expect(scan.referencedChunkNames).toEqual(expect.arrayContaining(SERVICE_WORKER_CHUNKS));
  });

  it('reports a file that is not a chunk-loading runtime without throwing', () => {
    const scan = collectChunkReferences('self.addEventListener("install",()=>{});');

    expect(scan.isChunkLoadingRuntime).toBe(false);
    expect(scan.referencedChunkNames).toEqual([]);
  });

  it('ignores chunk-shaped strings inside ordinary chunks', () => {
    // Scanning every packaged script means arbitrary string literals are in
    // scope; treating one as a reference would fail a perfectly good build.
    expect(collectChunkReferences(PLAIN_CHUNK_SOURCE)).toEqual({
      isChunkLoadingRuntime: false,
      referencedChunkNames: [],
    });
  });

  it('picks up literal chunk filenames inside a recognized runtime', () => {
    const scan = collectChunkReferences(
      `${SERVICE_WORKER_SOURCE}importScripts("./9999.0a2e30dcf299dd3b6515.js");`,
    );

    expect(scan.referencedChunkNames).toContain('9999.0a2e30dcf299dd3b6515.js');
  });
});

describe('evaluateArtifactChunkCompleteness', () => {
  it('unions the references of every chunk-loading runtime in the artifact', () => {
    const completeness = evaluateArtifactChunkCompleteness({
      entryNames: [...SERVICE_WORKER_CHUNKS, ...UI_RUNTIME_CHUNKS],
      javascriptEntries: javascriptEntries([]),
    });

    expect(completeness.complete).toBe(true);
    expect(completeness.runtimes.map((runtime) => runtime.entryName)).toEqual([
      'service-worker.js',
      'runtime.abc123abc123abc123ab.js',
    ]);
    expect(completeness.referencedChunkNames).toHaveLength(4);
  });

  it('reports the chunk that v13.45.0-no-lava shipped without', () => {
    const completeness = evaluateArtifactChunkCompleteness({
      entryNames: [
        ...SERVICE_WORKER_CHUNKS.filter((name) => !name.startsWith('1690.')),
        ...UI_RUNTIME_CHUNKS,
      ],
      javascriptEntries: javascriptEntries([]),
    });

    expect(completeness.complete).toBe(false);
    expect(completeness.missingChunkNames).toEqual(['1690.38d93430f4639781ca25.js']);
  });

  it('catches a chunk missing from the UI runtime even when the service worker is intact', () => {
    // The same deletion lottery applies to every runtime: a complete service
    // worker with a broken popup is still a broken artifact.
    const completeness = evaluateArtifactChunkCompleteness({
      entryNames: [
        ...SERVICE_WORKER_CHUNKS,
        ...UI_RUNTIME_CHUNKS.filter((name) => !name.startsWith('9828.')),
      ],
      javascriptEntries: javascriptEntries([]),
    });

    expect(completeness.complete).toBe(false);
    expect(completeness.missingChunkNames).toEqual(['9828.ce4b1c55046a8be22274.js']);
  });

  it('fails closed when no chunk-loading runtime is recognized anywhere', () => {
    // Zero recognized runtimes is indistinguishable from parser drift, so it can
    // never be reported as "nothing missing".
    expect(() =>
      evaluateArtifactChunkCompleteness({
        entryNames: ['service-worker.js'],
        javascriptEntries: [{ entryName: 'service-worker.js', source: PLAIN_CHUNK_SOURCE }],
      }),
    ).toThrow(UnrecognizedChunkReferencesError);
  });
});

describe('assertArtifactChunkCompleteness', () => {
  it('names every missing chunk in the failure', () => {
    expect(() =>
      assertArtifactChunkCompleteness('metamask-chrome-13.45.1-no-lava.zip', {
        entryNames: [],
        javascriptEntries: javascriptEntries([]),
      }),
    ).toThrow(/1690\.38d93430f4639781ca25\.js/);
  });

  it('rejects an artifact whose chunks are incomplete', () => {
    expect(() =>
      assertArtifactChunkCompleteness('metamask-chrome-13.45.1-no-lava.zip', {
        entryNames: UI_RUNTIME_CHUNKS,
        javascriptEntries: javascriptEntries([]),
      }),
    ).toThrow(IncompleteBuiltArtifactError);
  });

  it('accepts an artifact that carries every referenced chunk', () => {
    expect(
      assertArtifactChunkCompleteness('metamask-chrome-13.45.1-no-lava.zip', {
        entryNames: [...SERVICE_WORKER_CHUNKS, ...UI_RUNTIME_CHUNKS],
        javascriptEntries: javascriptEntries([]),
      }).complete,
    ).toBe(true);
  });
});

describe('verifyArtifactChunkCompleteness', () => {
  it('accepts a built zip that carries every chunk both of its runtimes load', async () => {
    const zipPath = createArtifactZip({
      chunkNames: [...SERVICE_WORKER_CHUNKS, ...UI_RUNTIME_CHUNKS],
    });

    const completeness = await verifyArtifactChunkCompleteness(zipPath);

    expect(completeness.complete).toBe(true);
    expect(completeness.serviceWorkerEntryName).toBe('service-worker.js');
    expect(completeness.runtimes).toHaveLength(2);
    expect(completeness.referencedChunkNames).toHaveLength(4);
  });

  it('rejects a built zip missing a chunk its service worker loads', async () => {
    const zipPath = createArtifactZip({
      chunkNames: [
        ...SERVICE_WORKER_CHUNKS.filter((name) => !name.startsWith('1690.')),
        ...UI_RUNTIME_CHUNKS,
      ],
    });

    await expect(verifyArtifactChunkCompleteness(zipPath)).rejects.toThrow(
      IncompleteBuiltArtifactError,
    );
  });

  it('rejects a built zip missing a chunk only its UI runtime loads', async () => {
    const zipPath = createArtifactZip({
      chunkNames: [
        ...SERVICE_WORKER_CHUNKS,
        ...UI_RUNTIME_CHUNKS.filter((name) => !name.startsWith('9828.')),
      ],
    });

    await expect(verifyArtifactChunkCompleteness(zipPath)).rejects.toThrow(
      /9828\.ce4b1c55046a8be22274\.js/,
    );
  });

  it('rejects a built zip whose manifest declares no MV3 service worker', async () => {
    const zipPath = createArtifactZip({
      chunkNames: [...SERVICE_WORKER_CHUNKS, ...UI_RUNTIME_CHUNKS],
      manifest: { manifest_version: 2, version: '13.45.1.0', background: { scripts: ['bg.js'] } },
    });

    await expect(verifyArtifactChunkCompleteness(zipPath)).rejects.toThrow(
      UnsupportedArtifactManifestError,
    );
  });
});
