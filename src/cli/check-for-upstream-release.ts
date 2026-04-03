import { toBuilderReleaseTag } from '../lib/contracts.js';
import { inspectGitHubRelease } from '../lib/github-release.js';
import {
  buildReleaseCheckDecision,
  loadFixtureReleaseRecord,
  resolveReleaseCheckDecision,
} from '../lib/upstream.js';

interface CliArgs {
  tag?: string;
  dryRun: boolean;
  fixtureRelease?: string;
  builderReleaseExists?: boolean;
  builderReleaseAssets?: string[];
  builderReleaseIntegrityValid?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
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

    if (argument === '--builder-release-assets') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--builder-release-assets requires a comma-separated value');
      }
      args.builderReleaseAssets = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (argument === '--builder-release-integrity-valid') {
      const value = argv[index + 1];
      if (value !== 'true' && value !== 'false') {
        throw new Error('--builder-release-integrity-valid requires true or false');
      }
      args.builderReleaseIntegrityValid = value === 'true';
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
        const inspection =
          args.builderReleaseExists === undefined && args.builderReleaseAssets === undefined
            ? await inspectGitHubRelease(builderReleaseTag)
            : {
                exists: args.builderReleaseExists ?? true,
                assetNames: args.builderReleaseAssets ?? [],
              };

        return buildReleaseCheckDecision({
          release,
          builderReleaseExists: inspection.exists,
          builderReleaseAssetNames: inspection.assetNames,
          builderReleaseIntegrityValid: args.builderReleaseIntegrityValid,
        });
      })()
    : await resolveReleaseCheckDecision(args.tag);

  console.log(
    JSON.stringify(
      {
        ...decision,
        dryRun: args.dryRun,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
