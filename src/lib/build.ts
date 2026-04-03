import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type BuildTarget, DEFAULT_BUILD_TARGET } from './contracts.js';
import { MissingBuiltArtifactError } from './errors.js';

const execFileAsync = promisify(execFile);

export interface BuildCommandOptions {
  buildTarget: 'dist';
}

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

export function buildCommandFor({ buildTarget }: BuildCommandOptions): string[] {
  return [
    'node',
    'development/build/index.js',
    buildTarget,
    '--apply-lavamoat=false',
    '--snow=false',
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
  await runCommand(
    buildCommandFor({ buildTarget: 'dist' }).at(0) as string,
    buildCommandFor({ buildTarget: 'dist' }).slice(1),
    options.sourceDir,
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
