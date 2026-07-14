export function expectedReferenceArtifacts(configuration, platform = process.platform) {
  return {
    ...configuration.reference_artifacts,
    ...configuration.reference_artifact_overrides?.[platform],
  };
}
