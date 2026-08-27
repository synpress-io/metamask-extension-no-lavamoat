export class BuilderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingChromeAssetError extends BuilderError {
  constructor(tag: string) {
    super(
      `Official MetaMask release ${tag} is missing the required Chrome asset`,
      'MISSING_CHROME_ASSET',
    );
  }
}

export class AmbiguousConfigError extends BuilderError {
  constructor(fieldName: string) {
    super(
      `Found multiple possible values for required config field ${fieldName}`,
      'AMBIGUOUS_CONFIG',
    );
  }
}

export class MissingExtractedConfigError extends BuilderError {
  constructor(fieldName: string) {
    super(
      `Could not extract required config field ${fieldName} from the official release zip`,
      'MISSING_EXTRACTED_CONFIG',
    );
  }
}

export class MissingBuiltArtifactError extends BuilderError {
  constructor(artifactName: string) {
    super(`Expected built artifact ${artifactName} was not produced`, 'MISSING_BUILT_ARTIFACT');
  }
}

export class UnsupportedArtifactManifestError extends BuilderError {
  constructor(artifactName: string, reason: string) {
    super(
      `Built artifact ${artifactName} does not carry a verifiable MV3 extension manifest: ${reason}`,
      'UNSUPPORTED_ARTIFACT_MANIFEST',
    );
  }
}

export class UnrecognizedChunkReferencesError extends BuilderError {
  constructor() {
    super(
      'No webpack chunk-loading runtime was recognized anywhere in the packaged extension; the chunk-reference parser no longer matches the built artifact',
      'UNRECOGNIZED_CHUNK_REFERENCES',
    );
  }
}

export class DependencyPatchAnchorMissingError extends BuilderError {
  constructor(packageName: string, filePath: string) {
    super(
      `Required build-time patch for ${packageName} (${filePath}) does not apply: the anchored source has changed, so the build would silently reintroduce the defect the patch prevents`,
      'DEPENDENCY_PATCH_ANCHOR_MISSING',
    );
  }
}

export class NoVerifiableArtifactError extends BuilderError {
  constructor(releaseTag: string) {
    super(
      `Release ${releaseTag} has no verifiable extension artifact; the publish gate would pass without inspecting anything`,
      'NO_VERIFIABLE_ARTIFACT',
    );
  }
}

export class IncompleteBuiltArtifactError extends BuilderError {
  constructor(artifactName: string, missingChunkNames: string[]) {
    super(
      `Built artifact ${artifactName} is missing ${missingChunkNames.length} webpack chunk(s) its packaged runtimes load: ${missingChunkNames.join(', ')}`,
      'INCOMPLETE_BUILT_ARTIFACT',
    );
  }
}
