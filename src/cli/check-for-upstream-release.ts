import { toBuilderReleaseTag } from '../lib/contracts.js';
import { checkGitHubReleaseExists } from '../lib/github-release.js';
import {
  fetchLatestUpstreamRelease,
  fetchUpstreamReleaseByTag,
  loadFixtureReleaseRecord,
  resolveReleaseCheckDecision
} from '../lib/upstream.js';

interface CliArgs {
  tag?: string;
  dryRun: boolean;
  fixtureRelease?: string;
  builderReleaseExists?: boolean;
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

    if (argument === '--builder-release-exists') {
      const value = argv[index + 1];
      if (value !== 'true' && value !== 'false') {
        throw new Error('--builder-release-exists requires true or false');
      }
      args.builderReleaseExists = value === 'true';
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const decision = args.fixtureRelease
    ? await (async () => {
        const release = await loadFixtureReleaseRecord(args.fixtureRelease as string);
        const builderReleaseTag = toBuilderReleaseTag(release.tag);
        const builderReleaseExists =
          args.builderReleaseExists ?? (await checkGitHubReleaseExists(builderReleaseTag));

        return {
          upstreamTag: release.tag,
          builderReleaseTag,
          shouldBuild: !builderReleaseExists,
          builderReleaseExists
        };
      })()
    : await resolveReleaseCheckDecision(args.tag);

  console.log(
    JSON.stringify(
      {
        ...decision,
        dryRun: args.dryRun
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
