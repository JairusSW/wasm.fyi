export function featureConfigurations(settings,platform=process.platform) {
  const ids=[...settings.collection.runtimes,...(settings.collection.featureRuntimes || []),...(settings.collection.featureRuntimesByPlatform?.[platform] || [])];
  return [...new Set(ids)].filter(id=>id!=='v8-wasmfx');
}
