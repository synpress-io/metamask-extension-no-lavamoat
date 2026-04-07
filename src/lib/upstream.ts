import { readFile } from 'node:fs/promises';
import {
  DEFAULT_BUILDER_REPOSITORY,
  deriveVersionFromTag,
  toBuilderReleaseTag,
  UPSTREAM_METAMASK_REPOSITORY,
} from './contracts.js';
import { MissingChromeAssetError } from './errors.js';
import {
  evaluateReleaseCompleteness,
  expectedReleaseAssetNames,
  inspectGitHubRelease,
  inspectPublishedReleaseIntegrity,
} from './github-release.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';

export interface GitHubReleaseAssetPayload {
  name: string;
  browser_download_url: string;
  digest?: string;
}

export interface GitHubReleasePayload {
  tag_name: string;
  tarball_url?: string;
  assets: GitHubReleaseAssetPayload[];
}

export interface UpstreamReleaseRecord {
  tag: string;
  version: string;
  sourceTarballUrl: string;
  chromeZipUrl: string;
  chromeZipSha256?: string;
  firefoxZipUrl?: string;
  firefoxZipSha256?: string;
}

export interface ReleaseCheckDecision {
  upstreamTag: string;
  builderReleaseTag: string;
  shouldBuild: boolean;
  builderReleaseExists: boolean;
  builderReleaseComplete: boolean;
  builderReleaseIntegrityValid: boolean;
  missingBuilderAssets: string[];
}

function normalizeDigest(digest?: string): string | undefined {
  if (!digest) {
    return undefined;
  }

  return digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
}

function releaseAssetName(target: 'chrome' | 'firefox', version: string): string {
  return `metamask-${target}-${version}.zip`;
}

function findAsset(
  assets: GitHubReleaseAssetPayload[],
  target: 'chrome' | 'firefox',
  version: string,
) {
  return assets.find((asset) => asset.name === releaseAssetName(target, version));
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

async function fetchGitHubRelease(url: string, token?: string): Promise<GitHubReleasePayload> {
  const response = await fetch(url, {
    headers: gitHubHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as GitHubReleasePayload;
}

export async function loadFixtureReleaseRecord(path: string): Promise<UpstreamReleaseRecord> {
  const payload = JSON.parse(await readFile(path, 'utf8')) as GitHubReleasePayload;
  return deriveReleaseRecord(payload);
}

export function deriveReleaseRecord(payload: GitHubReleasePayload): UpstreamReleaseRecord {
  const version = deriveVersionFromTag(payload.tag_name);
  const chromeAsset = findAsset(payload.assets, 'chrome', version);

  if (!chromeAsset) {
    throw new MissingChromeAssetError(payload.tag_name);
  }

  const firefoxAsset = findAsset(payload.assets, 'firefox', version);

  return {
    tag: payload.tag_name,
    version,
    sourceTarballUrl:
      payload.tarball_url ??
      `https://github.com/${UPSTREAM_METAMASK_REPOSITORY}/archive/refs/tags/${payload.tag_name}.tar.gz`,
    chromeZipUrl: chromeAsset.browser_download_url,
    chromeZipSha256: normalizeDigest(chromeAsset.digest),
    firefoxZipUrl: firefoxAsset?.browser_download_url,
    firefoxZipSha256: normalizeDigest(firefoxAsset?.digest),
  };
}

export async function fetchLatestUpstreamRelease(token?: string): Promise<UpstreamReleaseRecord> {
  const payload = await fetchGitHubRelease(
    `${GITHUB_API_BASE_URL}/repos/${UPSTREAM_METAMASK_REPOSITORY}/releases/latest`,
    token,
  );

  return deriveReleaseRecord(payload);
}

export async function fetchUpstreamReleaseByTag(
  tag: string,
  token?: string,
): Promise<UpstreamReleaseRecord> {
  const payload = await fetchGitHubRelease(
    `${GITHUB_API_BASE_URL}/repos/${UPSTREAM_METAMASK_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
    token,
  );

  return deriveReleaseRecord(payload);
}

export interface BuildReleaseCheckDecisionInput {
  release: UpstreamReleaseRecord;
  builderReleaseExists: boolean;
  builderReleaseAssetNames: string[];
  builderReleaseIntegrityValid?: boolean;
}

export function buildReleaseCheckDecision(
  input: BuildReleaseCheckDecisionInput,
): ReleaseCheckDecision {
  const builderReleaseTag = toBuilderReleaseTag(input.release.tag);
  const completeness = evaluateReleaseCompleteness({
    expectedAssetNames: expectedReleaseAssetNames(input.release.version),
    actualAssetNames: input.builderReleaseAssetNames,
  });

  return {
    upstreamTag: input.release.tag,
    builderReleaseTag,
    shouldBuild:
      !input.builderReleaseExists ||
      !completeness.complete ||
      input.builderReleaseIntegrityValid === false,
    builderReleaseExists: input.builderReleaseExists,
    builderReleaseComplete: input.builderReleaseExists && completeness.complete,
    builderReleaseIntegrityValid: input.builderReleaseExists
      ? (input.builderReleaseIntegrityValid ?? true)
      : false,
    missingBuilderAssets: input.builderReleaseExists
      ? completeness.missingAssetNames
      : expectedReleaseAssetNames(input.release.version),
  };
}

export async function resolveReleaseCheckDecision(
  tag?: string,
  token?: string,
): Promise<ReleaseCheckDecision> {
  const release = tag
    ? await fetchUpstreamReleaseByTag(tag, token)
    : await fetchLatestUpstreamRelease(token);
  const builderReleaseTag = toBuilderReleaseTag(release.tag);
  const inspection = await inspectGitHubRelease(
    builderReleaseTag,
    process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
    token,
  );
  const integrity = inspection.exists
    ? await inspectPublishedReleaseIntegrity(inspection, token, {
        expectedBuilderReleaseTag: builderReleaseTag,
        expectedRepository: process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
        expectedUpstreamTag: release.tag,
        expectedUpstreamVersion: release.version,
        expectedSourceTarballUrl: release.sourceTarballUrl,
        expectedOfficialChromeZipUrl: release.chromeZipUrl,
        expectedOfficialChromeZipSha256: release.chromeZipSha256,
      })
    : undefined;

  return buildReleaseCheckDecision({
    release,
    builderReleaseExists: inspection.exists,
    builderReleaseAssetNames: inspection.assetNames,
    builderReleaseIntegrityValid: integrity?.valid,
  });
}
