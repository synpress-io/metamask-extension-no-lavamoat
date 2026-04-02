import { stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { resolveBuildConfigFromOfficialReleaseZip } from '../lib/config.js';
import { executeNoLavaMoatBuild } from '../lib/build.js';
import { DEFAULT_BUILD_TARGET, DEFAULT_BUILDER_REPOSITORY, RELEASE_ARTIFACT_NAMES, toBuilderReleaseTag } from '../lib/contracts.js';
import { buildGitHubReleasePublishPlan, prepareReleaseArtifactCopies } from '../lib/github-release.js';
import { buildChecksumsText, buildReleaseManifest, type ReleaseManifestAsset } from '../lib/release-manifest.js';
import { prepareSourceWorkspace } from '../lib/source.js';
import { fetchLatestUpstreamRelease, fetchUpstreamReleaseByTag, loadFixtureReleaseRecord } from '../lib/upstream.js';

interface CliArgs {
  tag?: string;
  dryRun: boolean;
  fixtureRelease?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (argument === '--tag') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--tag requires a value');
      }
      args.tag = value;
      index += 1;
      continue;
    }

    if (argument === '--fixture-release') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--fixture-release requires a value');
      }
      args.fixtureRelease = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return args;
}

async function sha256(path: string): Promise<string> {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest('hex');
}

function currentCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return process.env.GITHUB_SHA;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = args.fixtureRelease
    ? await loadFixtureReleaseRecord(args.fixtureRelease)
    : args.tag
      ? await fetchUpstreamReleaseByTag(args.tag)
      : await fetchLatestUpstreamRelease();
  const builderReleaseTag = toBuilderReleaseTag(release.tag);

  if (args.dryRun) {
    const publishPlan = buildGitHubReleasePublishPlan({
      upstreamTag: release.tag,
      artifactPaths: [],
      checksumsPath: RELEASE_ARTIFACT_NAMES.checksums,
      manifestPath: RELEASE_ARTIFACT_NAMES.manifest
    });

    console.log(
      JSON.stringify(
        {
          upstreamTag: release.tag,
          builderReleaseTag,
          version: release.version,
          sourceTarballUrl: release.sourceTarballUrl,
          chromeZipUrl: release.chromeZipUrl,
          buildCommand: ['node', 'development/build/index.js', 'dist', '--apply-lavamoat=false', '--snow=false'],
          publishPlan
        },
        null,
        2
      )
    );
    return;
  }

  const workspace = await prepareSourceWorkspace(release);
  const config = await resolveBuildConfigFromOfficialReleaseZip({
    zipPath: workspace.officialChromeReleaseZipPath,
    secretInfuraProjectId: process.env.INFURA_PROJECT_ID
  });

  const artifacts = await executeNoLavaMoatBuild({
    sourceDir: workspace.sourceDir,
    version: release.version,
    infuraProjectId: config.infuraProjectId
  });

  const releaseDirectory = join(workspace.rootDir, 'release');
  const copiedArtifacts = await prepareReleaseArtifactCopies({
    releaseDirectory,
    version: release.version,
    artifactSources: {
      chrome: artifacts.chromeZipPath,
      firefox: artifacts.firefoxZipPath
    }
  });

  const releaseAssets: ReleaseManifestAsset[] = [
    {
      name: copiedArtifacts.chrome?.split('/').pop() as string,
      path: copiedArtifacts.chrome as string,
      sha256: await sha256(copiedArtifacts.chrome as string),
      size: (await stat(copiedArtifacts.chrome as string)).size
    }
  ];

  const checksums = buildChecksumsText(releaseAssets);
  const manifestPath = join(releaseDirectory, RELEASE_ARTIFACT_NAMES.manifest);
  const checksumsPath = join(releaseDirectory, RELEASE_ARTIFACT_NAMES.checksums);

  const manifest = buildReleaseManifest({
    upstreamTag: release.tag,
    upstreamVersion: release.version,
    sourceTarballUrl: release.sourceTarballUrl,
    officialChromeZipUrl: release.chromeZipUrl,
    officialChromeZipSha256: release.chromeZipSha256,
    builderReleaseTag: toBuilderReleaseTag(release.tag),
    targets: [DEFAULT_BUILD_TARGET],
    buildCommand: ['node', 'development/build/index.js', 'dist', '--apply-lavamoat=false', '--snow=false'],
    assets: releaseAssets,
    repository: process.env.GITHUB_REPOSITORY ?? DEFAULT_BUILDER_REPOSITORY,
    commit: currentCommit(),
    timestamp: new Date().toISOString()
  });

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(checksumsPath, checksums, 'utf8');

  const publishPlan = buildGitHubReleasePublishPlan({
    upstreamTag: release.tag,
    artifactPaths: releaseAssets.map((asset) => asset.path),
    checksumsPath,
    manifestPath
  });

  console.log(
    JSON.stringify(
      {
        upstreamTag: release.tag,
        workspaceRoot: workspace.rootDir,
        configSource: config.source,
        checksums,
        manifest,
        publishPlan
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
