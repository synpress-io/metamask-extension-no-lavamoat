export interface BlockedUpstreamTag {
  tag: string;
  reason: string;
  issueUrl: string;
}

/**
 * Upstream tags the builder must not attempt to build.
 *
 * The release gate already stops a broken artifact from being published, but on
 * its own it leaves the hourly monitor retrying — and failing — forever on a tag
 * that cannot currently be built. Listing the tag here keeps the monitor green
 * and states why in the repository, so unblocking is a reviewable change rather
 * than a silent retry.
 *
 * Empty is the healthy state.
 */
export const BLOCKED_UPSTREAM_TAGS: BlockedUpstreamTag[] = [];

export function findBlockedUpstreamTag(
  tag: string,
  blockedTags: BlockedUpstreamTag[] = BLOCKED_UPSTREAM_TAGS,
): BlockedUpstreamTag | undefined {
  return blockedTags.find((blockedTag) => blockedTag.tag === tag);
}
