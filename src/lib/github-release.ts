import { DEFAULT_BUILDER_REPOSITORY, toBuilderReleaseTag } from './contracts.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';

export interface GitHubReleasePublishPlanInput {
  upstreamTag: string;
  assetPaths: string[];
}

export interface GitHubReleasePublishPlan {
  tag: string;
  title: string;
  notes: string;
  assetPaths: string[];
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

export async function checkGitHubReleaseExists(
  releaseTag: string,
  repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
  token?: string
): Promise<boolean> {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`,
    {
      headers: gitHubHeaders(token)
    }
  );

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Builder release lookup failed (${response.status}) for ${releaseTag}`);
  }

  return true;
}

export function buildGitHubReleasePublishPlan(input: GitHubReleasePublishPlanInput): GitHubReleasePublishPlan {
  return {
    tag: toBuilderReleaseTag(input.upstreamTag),
    title: `${input.upstreamTag} (No LavaMoat)`,
    notes: `MetaMask ${input.upstreamTag} built without LavaMoat.`,
    assetPaths: input.assetPaths
  };
}
