import type { AppliedDependencyPatch } from './dependency-patch.js';

export interface ReleaseManifestAsset {
  name: string;
  path: string;
  sha256: string;
  size: number;
}

export interface BuildReleaseManifestInput {
  upstreamTag: string;
  upstreamVersion: string;
  sourceTarballUrl: string;
  officialChromeZipUrl: string;
  officialChromeZipSha256?: string;
  builderReleaseTag: string;
  targets: string[];
  buildCommand: string[];
  assets: ReleaseManifestAsset[];
  dependencyPatches: AppliedDependencyPatch[];
  repository: string;
  commit?: string;
  timestamp: string;
}

export interface ReleaseManifest {
  upstream: {
    tag: string;
    version: string;
    sourceTarballUrl: string;
    officialAssets: {
      chrome: {
        url: string;
        sha256?: string;
      };
    };
  };
  builder: {
    tag: string;
    repository: string;
    commit?: string;
    timestamp: string;
  };
  build: {
    targets: string[];
    command: string[];
    lavamoat: false;
    // Build-time dependency corrections applied to the MetaMask workspace before
    // compiling. Published so a consumer can always tell exactly how an artifact
    // differs from what an unmodified upstream checkout would produce.
    dependencyPatches: AppliedDependencyPatch[];
  };
  assets: ReleaseManifestAsset[];
}

export function buildReleaseManifest(input: BuildReleaseManifestInput): ReleaseManifest {
  return {
    upstream: {
      tag: input.upstreamTag,
      version: input.upstreamVersion,
      sourceTarballUrl: input.sourceTarballUrl,
      officialAssets: {
        chrome: {
          url: input.officialChromeZipUrl,
          sha256: input.officialChromeZipSha256,
        },
      },
    },
    builder: {
      tag: input.builderReleaseTag,
      repository: input.repository,
      commit: input.commit,
      timestamp: input.timestamp,
    },
    build: {
      targets: input.targets,
      command: input.buildCommand,
      lavamoat: false,
      dependencyPatches: input.dependencyPatches,
    },
    assets: input.assets,
  };
}

export function buildChecksumsText(assets: ReleaseManifestAsset[]): string {
  return `${assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n')}\n`;
}
