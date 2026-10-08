// Refresh the Wago-owned subset without dropping wasm.fyi's new core ports.
export function selectRetainedSources(ids, catalog, previous) {
  const replacements=previous.filter(b=>b.replaces&&ids.includes(b.id));
  const replacementIds=new Set(replacements.map(b=>b.id));
  const selected=catalog.filter(b=>ids.includes(b.id)&&!replacementIds.has(b.id));
  const found=[...selected,...replacements].map(b=>b.id);
  if(new Set(found).size!==ids.length||found.length!==ids.length||ids.some(id=>!found.includes(id))) {
    throw Error('Source refresh cannot resolve every selected core workload; refusing to replace the source lock');
  }
  return {selected,replacements};
}
