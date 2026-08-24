import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type BuildTarget, DEFAULT_BUILD_TARGET } from './contracts.js';
import { MissingBuiltArtifactError } from './errors.js';

const execFileAsync = promisify(execFile);

export interface BuildArtifacts {
  chromeZipPath: string;
  firefoxZipPath?: string;
}

export interface ExecuteBuildOptions {
  sourceDir: string;
  version: string;
  infuraProjectId: string;
  targets?: BuildTarget[];
}

// MetaMask >= v13.42.0 builds with webpack only (the gulp entrypoint
// `development/build/index.js` was removed). LavaMoat and Snow default to
// enabled in production mode, so both must be disabled explicitly.
export function buildCommandFor(targets: BuildTarget[]): string[] {
  return [
    'yarn',
    'webpack',
    '--mode',
    'production',
    '--no-lavamoat',
    '--no-snow',
    '--zip',
    ...targets.flatMap((target) => ['--browser', target]),
  ];
}

export function renderMetamaskRc(infuraProjectId: string): string {
  return `INFURA_PROJECT_ID=${infuraProjectId}\n`;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await execFileAsync(command, args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
}

async function ensureExists(path: string): Promise<void> {
  try {
    await access(path, fsConstants.F_OK);
  } catch {
    throw new MissingBuiltArtifactError(path);
  }
}

export async function executeNoLavaMoatBuild(
  options: ExecuteBuildOptions,
): Promise<BuildArtifacts> {
  const targets = options.targets ?? [DEFAULT_BUILD_TARGET];
  await writeFile(
    join(options.sourceDir, '.metamaskrc'),
    renderMetamaskRc(options.infuraProjectId),
    'utf8',
  );

  await runCommand('corepack', ['enable'], options.sourceDir);
  await runCommand('yarn', ['install', '--immutable'], options.sourceDir);

  const [buildExecutable, ...buildArguments] = buildCommandFor(targets);
  await runCommand(buildExecutable as string, buildArguments, options.sourceDir);

  const buildsDirectory = join(options.sourceDir, 'builds');
  const chromeZipPath = join(buildsDirectory, `metamask-chrome-${options.version}.zip`);
  const firefoxZipPath = join(buildsDirectory, `metamask-firefox-${options.version}.zip`);

  await ensureExists(chromeZipPath);

  if (targets.includes('firefox')) {
    await ensureExists(firefoxZipPath);
  }

  return {
    chromeZipPath,
    firefoxZipPath: targets.includes('firefox') ? firefoxZipPath : undefined,
  };
}
