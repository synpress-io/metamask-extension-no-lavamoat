import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveBuildConfigFromOfficialReleaseZip } from '../lib/config.js';
import { executeNoLavaMoatBuild } from '../lib/build.js';
import { prepareSourceWorkspace } from '../lib/source.js';
import { fetchLatestUpstreamRelease, fetchUpstreamReleaseByTag } from '../lib/upstream.js';

interface CliArgs {
  tag?: string;
  dryRun: boolean;
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

    throw new Error(`Unknown argument: ${argument}`);
  }

  return args;
}

async function sha256(path: string): Promise<string> {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = args.tag ? await fetchUpstreamReleaseByTag(args.tag) : await fetchLatestUpstreamRelease();

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          upstreamTag: release.tag,
          version: release.version,
          sourceTarballUrl: release.sourceTarballUrl,
          chromeZipUrl: release.chromeZipUrl,
          buildCommand: ['node', 'development/build/index.js', 'dist', '--apply-lavamoat=false', '--snow=false']
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

  console.log(
    JSON.stringify(
      {
        upstreamTag: release.tag,
        workspaceRoot: workspace.rootDir,
        artifacts: [
          {
            path: artifacts.chromeZipPath,
            sha256: await sha256(artifacts.chromeZipPath),
            size: (await stat(artifacts.chromeZipPath)).size
          }
        ]
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
