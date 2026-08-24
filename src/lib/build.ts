import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { type BuildTarget, DEFAULT_BUILD_TARGET } from './contracts.js';
import { MissingBuiltArtifactError } from './errors.js';

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
// `--no-cache` keeps the build in-process: with caching on, launch.ts forks a
// detached child whose failures are not propagated to the parent's exit code,
// and the cache never helps on single-use CI workspaces.
export function buildCommandFor(targets: BuildTarget[]): string[] {
  return [
    'yarn',
    'webpack',
    '--no-cache',
    '--mode',
    'production',
    '--no-lavamoat',
    '--no-snow',
    '--zip',
    ...targets.flatMap((target) => ['--browser', target]),
  ];
}

// Mirrors the heap sizing that upstream's launch.ts applies to its forked
// build process; the in-process (`--no-cache`) path skips that tuning.
export function buildEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const maxOldSpaceMb = Math.floor((totalmem() * 0.75) / (1 << 20));
  const nodeOptions = [baseEnv.NODE_OPTIONS, `--max-old-space-size=${maxOldSpaceMb}`]
    .filter(Boolean)
    .join(' ');
  return { ...baseEnv, NODE_OPTIONS: nodeOptions };
}

export function renderMetamaskRc(infuraProjectId: string): string {
  return `INFURA_PROJECT_ID=${infuraProjectId}\n`;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      // Stream all child output to stderr: the CLI reserves stdout for its
      // JSON result, and build failures must stay visible in workflow logs.
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.pipe(process.stderr);
    child.stderr.pipe(process.stderr);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const cause = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`Command failed (${cause}): ${command} ${args.join(' ')}`));
    });
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
  await runCommand(
    buildExecutable as string,
    buildArguments,
    options.sourceDir,
    buildEnvironment(process.env),
  );

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
