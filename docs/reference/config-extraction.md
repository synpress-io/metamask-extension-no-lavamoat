# Config Extraction Contract

## Allowed Extracted Values

The builder intentionally extracts a very small set of values from the official MetaMask release ZIP. At the start of this project, the only planned extracted value is:

- `INFURA_PROJECT_ID`

## Fallback Policy

- Preferred source: the official MetaMask release ZIP for the same upstream tag.
- Fallback source: explicit GitHub Actions secret or local environment variable.
- No third source exists. If the value cannot be extracted and no fallback is provided, the build must fail.

## Fail-Closed Rules

- Do not scrape arbitrary config values from bundled files.
- Do not guess when multiple matches are present.
- Do not silently continue with an empty or malformed extracted value.
- Do not widen the extraction surface without updating this document and the shared code contract.
