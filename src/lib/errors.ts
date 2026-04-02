export class BuilderError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingChromeAssetError extends BuilderError {
  constructor(tag: string) {
    super(`Official MetaMask release ${tag} is missing the required Chrome asset`, 'MISSING_CHROME_ASSET');
  }
}

export class AmbiguousConfigError extends BuilderError {
  constructor(fieldName: string) {
    super(`Found multiple possible values for required config field ${fieldName}`, 'AMBIGUOUS_CONFIG');
  }
}

export class MissingSecretFallbackError extends BuilderError {
  constructor(fieldName: string) {
    super(`No extracted value or secret fallback was provided for ${fieldName}`, 'MISSING_SECRET_FALLBACK');
  }
}

export class MissingBuiltArtifactError extends BuilderError {
  constructor(artifactName: string) {
    super(`Expected built artifact ${artifactName} was not produced`, 'MISSING_BUILT_ARTIFACT');
  }
}
