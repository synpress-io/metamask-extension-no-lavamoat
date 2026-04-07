import { copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type BuildTarget,
  DEFAULT_BUILD_TARGET,
  DEFAULT_BUILDER_REPOSITORY,
  RELEASE_ARTIFACT_NAMES,
  toArtifactFileName,
  toBuilderReleaseTag,
} from './contracts.js';
import type { ReleaseManifest } from './release-manifest.js';

const GITHUB_API_BASE_URL = process.env.GITHUB_API_BASE_URL ?? 'https://api.github.com';

export interface GitHubReleasePublishPlanInput {
  upstreamTag: string;
  artifactPaths: string[];
  checksumsPath: string;
  manifestPath: string;
}

export interface GitHubReleasePublishPlan {
  tag: string;
  title: string;
  notes: string;
  assetPaths: string[];
}

export interface GitHubReleaseInspection {
  exists: boolean;
  assets: GitHubReleaseAsset[];
  assetNames: string[];
}

export interface ReleaseCompletenessInput {
  expectedAssetNames: string[];
  actualAssetNames: string[];
}

export interface ReleaseCompleteness {
  complete: boolean;
  missingAssetNames: string[];
}

export interface GitHubReleaseAsset {
  name: string;
  digest?: string;
  apiUrl?: string;
  browserDownloadUrl?: string;
}

export interface ExpectedReleaseAsset {
  path: string;
  sha256?: string;
}

export interface ReleaseIntegrityInput {
  expectedAssets: ExpectedReleaseAsset[];
  actualAssets: GitHubReleaseAsset[];
}

export interface ReleaseIntegrity {
  complete: boolean;
  missingAssetNames: string[];
  mismatchedDigestAssetNames: string[];
}

export interface PublishedReleaseIntegrity {
  valid: boolean;
  missingAssetNames: string[];
  mismatchedAssetNames: string[];
}

export interface PublishedReleaseIntegrityExpectation {
  expectedBuilderReleaseTag?: string;
  expectedRepository?: string;
  expectedUpstreamTag?: string;
  expectedUpstreamVersion?: string;
  expectedSourceTarballUrl?: string;
  expectedOfficialChromeZipUrl?: string;
  expectedOfficialChromeZipSha256?: string;
}

export interface EnsureGitHubReleaseAssetsInput {
  repository: string;
  releaseTag: string;
  releaseTitle: string;
  releaseNotes: string;
  assets: ExpectedReleaseAsset[];
}

export interface EnsureGitHubReleaseAssetsResult {
  created: boolean;
  repaired: boolean;
  finalAssetNames: string[];
  missingAssetNames: string[];
}

export interface GitHubReleaseMutator {
  inspectRelease(
    releaseTag: string,
    repository: string,
    token?: string,
  ): Promise<GitHubReleaseInspection>;
  createRelease(input: EnsureGitHubReleaseAssetsInput): Promise<void>;
  uploadAssets(releaseTag: string, repository: string, assetPaths: string[]): Promise<void>;
}

function gitHubHeaders(token = process.env.GITHUB_TOKEN): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'synpress-metamask-no-lava-builder',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function inspectGitHubRelease(
  releaseTag: string,
  repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
  token?: string,
): Promise<GitHubReleaseInspection> {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`,
    {
      headers: gitHubHeaders(token),
    },
  );

  if (response.status === 404) {
    return {
      exists: false,
      assets: [],
      assetNames: [],
    };
  }

  if (!response.ok) {
    throw new Error(`Builder release lookup failed (${response.status}) for ${releaseTag}`);
  }

  const payload = (await response.json()) as {
    assets?: Array<{ name?: string; digest?: string; browser_download_url?: string; url?: string }>;
  };

  const assets = (payload.assets ?? []).flatMap((asset) =>
    asset.name
      ? [
          {
            name: asset.name,
            digest: asset.digest,
            apiUrl: asset.url,
            browserDownloadUrl: asset.browser_download_url,
          },
        ]
      : [],
  );

  return {
    exists: true,
    assets,
    assetNames: assets.map((asset) => asset.name),
  };
}

export async function checkGitHubReleaseExists(
  releaseTag: string,
  repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
  token?: string,
): Promise<boolean> {
  const inspection = await inspectGitHubRelease(releaseTag, repository, token);
  return inspection.exists;
}

export interface PrepareReleaseArtifactCopiesInput {
  releaseDirectory: string;
  version: string;
  artifactSources: Partial<Record<BuildTarget, string>>;
}

export async function prepareReleaseArtifactCopies(
  input: PrepareReleaseArtifactCopiesInput,
): Promise<Partial<Record<BuildTarget, string>>> {
  await mkdir(input.releaseDirectory, { recursive: true });

  const copied: Partial<Record<BuildTarget, string>> = {};

  for (const target of Object.keys(input.artifactSources) as BuildTarget[]) {
    const sourcePath = input.artifactSources[target];
    if (!sourcePath) {
      continue;
    }

    const destinationPath = join(input.releaseDirectory, toArtifactFileName(target, input.version));
    await copyFile(sourcePath, destinationPath);
    copied[target] = destinationPath;
  }

  return copied;
}

export function expectedReleaseAssetNames(
  version: string,
  targets: BuildTarget[] = [DEFAULT_BUILD_TARGET],
): string[] {
  return [
    ...targets.map((target) => toArtifactFileName(target, version)),
    RELEASE_ARTIFACT_NAMES.checksums,
    RELEASE_ARTIFACT_NAMES.manifest,
  ];
}

export function evaluateReleaseCompleteness(input: ReleaseCompletenessInput): ReleaseCompleteness {
  const actual = new Set(input.actualAssetNames);
  const missingAssetNames = input.expectedAssetNames.filter((assetName) => !actual.has(assetName));

  return {
    complete: missingAssetNames.length === 0,
    missingAssetNames,
  };
}

export function missingReleaseAssetPaths(
  assetPaths: string[],
  existingAssetNames: string[],
): string[] {
  const existing = new Set(existingAssetNames);
  return assetPaths.filter((assetPath) => !existing.has(basename(assetPath)));
}

function normalizeDigest(digest?: string): string | undefined {
  if (!digest) {
    return undefined;
  }

  return digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
}

export function evaluateReleaseIntegrity(input: ReleaseIntegrityInput): ReleaseIntegrity {
  const actualByName = new Map(input.actualAssets.map((asset) => [asset.name, asset]));
  const missingAssetNames: string[] = [];
  const mismatchedDigestAssetNames: string[] = [];

  for (const expectedAsset of input.expectedAssets) {
    const expectedName = basename(expectedAsset.path);
    const actualAsset = actualByName.get(expectedName);

    if (!actualAsset) {
      missingAssetNames.push(expectedName);
      continue;
    }

    if (expectedAsset.sha256) {
      const actualDigest = normalizeDigest(actualAsset.digest);
      if (!actualDigest || actualDigest !== expectedAsset.sha256) {
        mismatchedDigestAssetNames.push(expectedName);
      }
    }
  }

  return {
    complete: missingAssetNames.length === 0 && mismatchedDigestAssetNames.length === 0,
    missingAssetNames,
    mismatchedDigestAssetNames,
  };
}

function parseChecksumsText(contents: string): Map<string, string> {
  return new Map(
    contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const match = /^([a-fA-F0-9]{64})\s{2}(.+)$/.exec(line);
        return match ? [[match[2], match[1].toLowerCase()] as const] : [];
      }),
  );
}

function isReleaseManifest(value: unknown): value is ReleaseManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    upstream?: {
      tag?: unknown;
      version?: unknown;
      sourceTarballUrl?: unknown;
      officialAssets?: {
        chrome?: {
          url?: unknown;
          sha256?: unknown;
        };
      };
    };
    builder?: {
      tag?: unknown;
      repository?: unknown;
      commit?: unknown;
      timestamp?: unknown;
    };
    build?: {
      targets?: unknown;
      command?: unknown;
      lavamoat?: unknown;
    };
    assets?: unknown;
  };

  const targets = candidate.build?.targets;
  const command = candidate.build?.command;

  if (
    typeof candidate.upstream?.tag !== 'string' ||
    candidate.upstream.tag.length === 0 ||
    typeof candidate.upstream.version !== 'string' ||
    candidate.upstream.version.length === 0 ||
    typeof candidate.upstream.sourceTarballUrl !== 'string' ||
    candidate.upstream.sourceTarballUrl.length === 0 ||
    typeof candidate.upstream.officialAssets?.chrome?.url !== 'string' ||
    candidate.upstream.officialAssets.chrome.url.length === 0 ||
    typeof candidate.builder?.tag !== 'string' ||
    candidate.builder.tag.length === 0 ||
    typeof candidate.builder.repository !== 'string' ||
    candidate.builder.repository.length === 0 ||
    typeof candidate.builder.timestamp !== 'string' ||
    candidate.builder.timestamp.length === 0 ||
    !Array.isArray(targets) ||
    targets.length === 0 ||
    !targets.every((target) => typeof target === 'string' && target.length > 0) ||
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every((entry) => typeof entry === 'string' && entry.length > 0) ||
    candidate.build?.lavamoat !== false ||
    !Array.isArray(candidate.assets) ||
    candidate.assets.length === 0
  ) {
    return false;
  }

  return candidate.assets.every((asset) => {
    if (!asset || typeof asset !== 'object') {
      return false;
    }

    const record = asset as { name?: unknown; sha256?: unknown; path?: unknown; size?: unknown };
    return (
      typeof record.name === 'string' &&
      record.name.length > 0 &&
      typeof record.path === 'string' &&
      record.path.length > 0 &&
      typeof record.sha256 === 'string' &&
      /^[a-fA-F0-9]{64}$/.test(record.sha256) &&
      typeof record.size === 'number' &&
      Number.isFinite(record.size) &&
      record.size >= 0
    );
  });
}

async function downloadReleaseAsset(
  asset: Pick<GitHubReleaseAsset, 'apiUrl' | 'browserDownloadUrl'>,
  token?: string,
): Promise<Response> {
  if (asset.apiUrl) {
    return fetch(asset.apiUrl, {
      headers: {
        ...gitHubHeaders(token),
        Accept: 'application/octet-stream',
      },
    });
  }

  if (asset.browserDownloadUrl) {
    return fetch(asset.browserDownloadUrl, {
      headers: gitHubHeaders(token),
    });
  }

  return new Response(null, { status: 404 });
}

export async function inspectPublishedReleaseIntegrity(
  inspection: GitHubReleaseInspection,
  token?: string,
  expectation: PublishedReleaseIntegrityExpectation = {},
): Promise<PublishedReleaseIntegrity> {
  const assetsByName = new Map(inspection.assets.map((asset) => [asset.name, asset]));
  const manifestAsset = assetsByName.get(RELEASE_ARTIFACT_NAMES.manifest);
  const checksumsAsset = assetsByName.get(RELEASE_ARTIFACT_NAMES.checksums);

  if (
    (!manifestAsset?.apiUrl && !manifestAsset?.browserDownloadUrl) ||
    (!checksumsAsset?.apiUrl && !checksumsAsset?.browserDownloadUrl)
  ) {
    return {
      valid: false,
      missingAssetNames: [
        ...(manifestAsset?.apiUrl || manifestAsset?.browserDownloadUrl
          ? []
          : [RELEASE_ARTIFACT_NAMES.manifest]),
        ...(checksumsAsset?.apiUrl || checksumsAsset?.browserDownloadUrl
          ? []
          : [RELEASE_ARTIFACT_NAMES.checksums]),
      ],
      mismatchedAssetNames: [],
    };
  }

  const [manifestResponse, checksumsResponse] = await Promise.all([
    downloadReleaseAsset(manifestAsset, token),
    downloadReleaseAsset(checksumsAsset, token),
  ]);

  if (!manifestResponse.ok || !checksumsResponse.ok) {
    return {
      valid: false,
      missingAssetNames: [],
      mismatchedAssetNames: [
        ...(!manifestResponse.ok ? [RELEASE_ARTIFACT_NAMES.manifest] : []),
        ...(!checksumsResponse.ok ? [RELEASE_ARTIFACT_NAMES.checksums] : []),
      ],
    };
  }

  let manifestPayload: unknown;
  try {
    manifestPayload = await manifestResponse.json();
  } catch {
    return {
      valid: false,
      missingAssetNames: [],
      mismatchedAssetNames: [RELEASE_ARTIFACT_NAMES.manifest],
    };
  }

  if (!isReleaseManifest(manifestPayload)) {
    return {
      valid: false,
      missingAssetNames: [],
      mismatchedAssetNames: [RELEASE_ARTIFACT_NAMES.manifest],
    };
  }

  const manifest = manifestPayload;
  const checksums = parseChecksumsText(await checksumsResponse.text());
  const missingAssetNames: string[] = [];
  const mismatchedAssetNames: string[] = [];

  if (
    (expectation.expectedBuilderReleaseTag &&
      manifest.builder.tag !== expectation.expectedBuilderReleaseTag) ||
    (expectation.expectedRepository &&
      manifest.builder.repository !== expectation.expectedRepository) ||
    (expectation.expectedUpstreamTag &&
      manifest.upstream.tag !== expectation.expectedUpstreamTag) ||
    (expectation.expectedUpstreamVersion &&
      manifest.upstream.version !== expectation.expectedUpstreamVersion) ||
    (expectation.expectedSourceTarballUrl &&
      manifest.upstream.sourceTarballUrl !== expectation.expectedSourceTarballUrl) ||
    (expectation.expectedOfficialChromeZipUrl &&
      manifest.upstream.officialAssets.chrome.url !== expectation.expectedOfficialChromeZipUrl) ||
    (expectation.expectedOfficialChromeZipSha256 &&
      manifest.upstream.officialAssets.chrome.sha256 !==
        expectation.expectedOfficialChromeZipSha256)
  ) {
    return {
      valid: false,
      missingAssetNames: [],
      mismatchedAssetNames: [RELEASE_ARTIFACT_NAMES.manifest],
    };
  }

  for (const expectedAsset of manifest.assets) {
    const actualAsset = assetsByName.get(expectedAsset.name);
    if (!actualAsset) {
      missingAssetNames.push(expectedAsset.name);
      continue;
    }

    const actualDigest = normalizeDigest(actualAsset.digest);
    if (!actualDigest || actualDigest !== expectedAsset.sha256) {
      mismatchedAssetNames.push(expectedAsset.name);
      continue;
    }

    const checksumDigest = checksums.get(expectedAsset.name);
    if (!checksumDigest || checksumDigest !== expectedAsset.sha256) {
      mismatchedAssetNames.push(expectedAsset.name);
    }
  }

  return {
    valid: missingAssetNames.length === 0 && mismatchedAssetNames.length === 0,
    missingAssetNames,
    mismatchedAssetNames: Array.from(new Set(mismatchedAssetNames)),
  };
}

async function repairReleaseIfNeeded(
  input: EnsureGitHubReleaseAssetsInput,
  inspection: GitHubReleaseInspection,
  mutator: GitHubReleaseMutator,
): Promise<EnsureGitHubReleaseAssetsResult> {
  const integrity = evaluateReleaseIntegrity({
    expectedAssets: input.assets,
    actualAssets: inspection.assets,
  });
  const expectedAssetsByName = new Map(input.assets.map((asset) => [basename(asset.path), asset]));
  const missingAssetPaths = [
    ...integrity.missingAssetNames,
    ...integrity.mismatchedDigestAssetNames,
  ].flatMap((assetName) => {
    const asset = expectedAssetsByName.get(assetName);
    return asset ? [asset.path] : [];
  });

  if (missingAssetPaths.length > 0) {
    await mutator.uploadAssets(input.releaseTag, input.repository, missingAssetPaths);
  }

  const finalInspection = await mutator.inspectRelease(input.releaseTag, input.repository);
  const finalIntegrity = evaluateReleaseIntegrity({
    expectedAssets: input.assets,
    actualAssets: finalInspection.assets,
  });

  if (!finalInspection.exists || !finalIntegrity.complete) {
    throw new Error(
      `GitHub release ${input.releaseTag} is incomplete after publish/repair; missing assets: ${finalIntegrity.missingAssetNames.join(', ')}, mismatched assets: ${finalIntegrity.mismatchedDigestAssetNames.join(', ')}`,
    );
  }

  return {
    created: false,
    repaired: missingAssetPaths.length > 0,
    finalAssetNames: finalInspection.assetNames,
    missingAssetNames: finalIntegrity.missingAssetNames,
  };
}

export async function ensureGitHubReleaseAssets(
  input: EnsureGitHubReleaseAssetsInput,
  mutator: GitHubReleaseMutator,
): Promise<EnsureGitHubReleaseAssetsResult> {
  const initialInspection = await mutator.inspectRelease(input.releaseTag, input.repository);
  if (initialInspection.exists) {
    return repairReleaseIfNeeded(input, initialInspection, mutator);
  }

  try {
    await mutator.createRelease(input);
  } catch {
    const postFailureInspection = await mutator.inspectRelease(input.releaseTag, input.repository);
    if (!postFailureInspection.exists) {
      throw new Error(`GitHub release creation failed for ${input.releaseTag}`);
    }

    return repairReleaseIfNeeded(input, postFailureInspection, mutator);
  }

  const postCreateInspection = await mutator.inspectRelease(input.releaseTag, input.repository);
  const repairedResult = await repairReleaseIfNeeded(input, postCreateInspection, mutator);

  return {
    ...repairedResult,
    created: true,
  };
}

export function buildGitHubReleasePublishPlan(
  input: GitHubReleasePublishPlanInput,
): GitHubReleasePublishPlan {
  return {
    tag: toBuilderReleaseTag(input.upstreamTag),
    title: `${input.upstreamTag} (No Lava)`,
    notes: `MetaMask ${input.upstreamTag} built without LavaMoat.`,
    assetPaths: [...input.artifactPaths, input.checksumsPath, input.manifestPath],
  };
}
