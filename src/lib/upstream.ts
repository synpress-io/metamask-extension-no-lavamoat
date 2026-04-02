import {
  DEFAULT_BUILDER_REPOSITORY,
  UPSTREAM_METAMASK_REPOSITORY,
  deriveVersionFromTag,
  toBuilderReleaseTag
} from './contracts.js';
import { MissingChromeAssetError } from './errors.js';

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

function findAsset(assets: GitHubReleaseAssetPayload[], target: 'chrome' | 'firefox', version: string) {
  return assets.find((asset) => asset.name === releaseAssetName(target, version));
}

function gitHubHeaders(token = process.env.GITHUB_TOKEN): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'synpress-metamask-no-lavamoat-builder'
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchGitHubRelease(url: string, token?: string): Promise<GitHubReleasePayload> {
  const response = await fetch(url, {
    headers: gitHubHeaders(token)
  });

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as GitHubReleasePayload;
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
    sourceTarballUrl: payload.tarball_url ?? `https://github.com/${UPSTREAM_METAMASK_REPOSITORY}/archive/refs/tags/${payload.tag_name}.tar.gz`,
    chromeZipUrl: chromeAsset.browser_download_url,
    chromeZipSha256: normalizeDigest(chromeAsset.digest),
    firefoxZipUrl: firefoxAsset?.browser_download_url,
    firefoxZipSha256: normalizeDigest(firefoxAsset?.digest)
  };
}

export async function fetchLatestUpstreamRelease(token?: string): Promise<UpstreamReleaseRecord> {
  const payload = await fetchGitHubRelease(
    `${GITHUB_API_BASE_URL}/repos/${UPSTREAM_METAMASK_REPOSITORY}/releases/latest`,
    token
  );

  return deriveReleaseRecord(payload);
}

export async function fetchUpstreamReleaseByTag(tag: string, token?: string): Promise<UpstreamReleaseRecord> {
  const payload = await fetchGitHubRelease(
    `${GITHUB_API_BASE_URL}/repos/${UPSTREAM_METAMASK_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
    token
  );

  return deriveReleaseRecord(payload);
}

export async function builderReleaseExists(
  builderReleaseTag: string,
  repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
  token?: string
): Promise<boolean> {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repository}/releases/tags/${encodeURIComponent(builderReleaseTag)}`,
    {
      headers: gitHubHeaders(token)
    }
  );

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Builder release lookup failed (${response.status}) for ${builderReleaseTag}`);
  }

  return true;
}

export async function resolveReleaseCheckDecision(tag?: string, token?: string): Promise<ReleaseCheckDecision> {
  const release = tag ? await fetchUpstreamReleaseByTag(tag, token) : await fetchLatestUpstreamRelease(token);
  const builderReleaseTag = toBuilderReleaseTag(release.tag);
  const exists = await builderReleaseExists(builderReleaseTag, undefined, token);

  return {
    upstreamTag: release.tag,
    builderReleaseTag,
    shouldBuild: !exists,
    builderReleaseExists: exists
  };
}
