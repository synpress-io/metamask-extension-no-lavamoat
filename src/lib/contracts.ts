export const BUILDER_RELEASE_SUFFIX = '-no-lavamoat' as const;

export const SUPPORTED_BUILD_TARGETS = ['chrome', 'firefox'] as const;

export type BuildTarget = (typeof SUPPORTED_BUILD_TARGETS)[number];

export const DEFAULT_BUILD_TARGET: BuildTarget = 'chrome';

export const RELEASE_ARTIFACT_NAMES = {
  checksums: 'SHA256SUMS.txt',
  manifest: 'release-manifest.json'
} as const;

export const RELEASE_MANIFEST_KEYS = {
  upstream: 'upstream',
  builder: 'builder',
  build: 'build',
  assets: 'assets'
} as const;

export function deriveVersionFromTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

export function toBuilderReleaseTag(upstreamTag: string): string {
  return `${upstreamTag}${BUILDER_RELEASE_SUFFIX}`;
}

export function toArtifactFileName(target: BuildTarget, version: string): string {
  return `metamask-${target}-${version}${BUILDER_RELEASE_SUFFIX}.zip`;
}
