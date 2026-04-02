import { fetchLatestUpstreamRelease, loadFixtureReleaseRecord } from '../lib/upstream.js';

interface CliArgs {
  fixtureRelease?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = args.fixtureRelease
    ? await loadFixtureReleaseRecord(args.fixtureRelease)
    : await fetchLatestUpstreamRelease();

  process.stdout.write(release.tag);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
