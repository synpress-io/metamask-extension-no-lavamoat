import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AmbiguousConfigError, MissingSecretFallbackError } from './errors.js';

const execFileAsync = promisify(execFile);

const TEXT_ENTRY_EXTENSIONS = ['.js', '.json', '.html', '.css', '.txt'] as const;
const INFURA_PROJECT_ID_FIELD = 'INFURA_PROJECT_ID' as const;
const INFURA_PROJECT_ID_PATTERNS = [
  /\binfuraProjectId\s*=\s*['"]([a-f0-9]{32})['"]/gi,
  /\bglobalThis\.INFURA_PROJECT_ID\s*=\s*[^"'`\n;,]*\?\?\s*['"]([a-f0-9]{32})['"]/gi,
  /\binfuraProjectId\s*=\s*globalThis\.INFURA_PROJECT_ID\s*\?\?\s*['"]([a-f0-9]{32})['"]/gi,
] as const;

export interface BuildConfig {
  infuraProjectId: string;
  source: 'official-release' | 'secret-fallback';
}

export interface ResolveBuildConfigInput {
  extractedReleaseFiles: string[];
  secretInfuraProjectId?: string;
}

export interface ResolveBuildConfigFromZipInput {
  zipPath: string;
  secretInfuraProjectId?: string;
}

function extractInfuraProjectIds(extractedReleaseFiles: string[]): string[] {
  const matches = new Set<string>();

  for (const fileContents of extractedReleaseFiles) {
    for (const pattern of INFURA_PROJECT_ID_PATTERNS) {
      pattern.lastIndex = 0;

      let match = pattern.exec(fileContents);
      while (match) {
        matches.add(match[1].toLowerCase());
        match = pattern.exec(fileContents);
      }
    }
  }

  return [...matches];
}

function isTextEntry(entryName: string): boolean {
  return TEXT_ENTRY_EXTENSIONS.some((extension) => entryName.endsWith(extension));
}

async function readZipTextEntries(zipPath: string): Promise<string[]> {
  const { stdout: listOutput } = await execFileAsync('unzip', ['-Z1', zipPath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const entryNames = listOutput
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && isTextEntry(entry));

  const contents = await Promise.all(
    entryNames.map(async (entryName) => {
      const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entryName], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });

      return stdout;
    }),
  );

  return contents;
}

export function resolveBuildConfig(input: ResolveBuildConfigInput): BuildConfig {
  const extractedIds = extractInfuraProjectIds(input.extractedReleaseFiles);

  if (extractedIds.length > 1) {
    throw new AmbiguousConfigError(INFURA_PROJECT_ID_FIELD);
  }

  if (extractedIds.length === 1) {
    return {
      infuraProjectId: extractedIds[0],
      source: 'official-release',
    };
  }

  if (!input.secretInfuraProjectId) {
    throw new MissingSecretFallbackError(INFURA_PROJECT_ID_FIELD);
  }

  return {
    infuraProjectId: input.secretInfuraProjectId,
    source: 'secret-fallback',
  };
}

export async function resolveBuildConfigFromOfficialReleaseZip(
  input: ResolveBuildConfigFromZipInput,
): Promise<BuildConfig> {
  const extractedReleaseFiles = await readZipTextEntries(input.zipPath);
  return resolveBuildConfig({
    extractedReleaseFiles,
    secretInfuraProjectId: input.secretInfuraProjectId,
  });
}
