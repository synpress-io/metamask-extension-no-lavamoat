import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { DEFAULT_BUILDER_REPOSITORY } from '../lib/contracts.js';
import {
  type EnsureGitHubReleaseAssetsInput,
  ensureGitHubReleaseAssets,
  type GitHubReleaseMutator,
  inspectGitHubRelease,
} from '../lib/github-release.js';

const execFileAsync = promisify(execFile);

interface CliArgs {
  buildOutputPath: string;
}

interface BuildOutputPayload {
  publishPlan: {
    tag: string;
    title: string;
    notes: string;
    assetPaths: string[];
  };
}

function parseArgs(argv: string[]): CliArgs {
  let buildOutputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--build-output') {
      buildOutputPath = argv[index + 1];
      if (!buildOutputPath) {
        throw new Error('--build-output requires a value');
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!buildOutputPath) {
    throw new Error('--build-output is required');
  }

  return { buildOutputPath };
}

async function loadPublishInput(buildOutputPath: string): Promise<EnsureGitHubReleaseAssetsInput> {
  const payload = JSON.parse(await readFile(buildOutputPath, 'utf8')) as BuildOutputPayload;
  const repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY;
  const assets = await Promise.all(
    payload.publishPlan.assetPaths.map(async (assetPath) => ({
      path: assetPath,
      sha256: createHash('sha256')
        .update(await readFile(assetPath))
        .digest('hex'),
    })),
  );

  return {
    repository,
    releaseTag: payload.publishPlan.tag,
    releaseTitle: payload.publishPlan.title,
    releaseNotes: payload.publishPlan.notes,
    assets,
  };
}

function ghEnvironment(): NodeJS.ProcessEnv {
  if (process.env.GH_TOKEN || !process.env.GITHUB_TOKEN) {
    return process.env;
  }

  return {
    ...process.env,
    GH_TOKEN: process.env.GITHUB_TOKEN,
  };
}

const ghMutator: GitHubReleaseMutator = {
  inspectRelease(releaseTag, repository) {
    return inspectGitHubRelease(
      releaseTag,
      repository,
      process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    );
  },
  async createRelease(input) {
    await execFileAsync(
      process.env.GH_BIN ?? 'gh',
      [
        'release',
        'create',
        input.releaseTag,
        ...input.assets.map((asset) => asset.path),
        '--repo',
        input.repository,
        '--title',
        input.releaseTitle,
        '--notes',
        input.releaseNotes,
      ],
      { env: ghEnvironment() },
    );
  },
  async uploadAssets(releaseTag, repository, assetPaths) {
    if (assetPaths.length === 0) {
      return;
    }

    await execFileAsync(
      process.env.GH_BIN ?? 'gh',
      ['release', 'upload', releaseTag, ...assetPaths, '--repo', repository, '--clobber'],
      { env: ghEnvironment() },
    );
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const publishInput = await loadPublishInput(args.buildOutputPath);
  const result = await ensureGitHubReleaseAssets(publishInput, ghMutator);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
