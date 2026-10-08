// Module registry timestamps describe commits, not GitHub publication events.
export function mergeGoModuleVersions(repository,releases,versions) {
 const merged=new Map(releases.map(release=>[release.tag_name,{...release}]));
 for(const info of versions){
  if(!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(info.Version)||/-\d{14}-[0-9a-f]+$/.test(info.Version))throw Error('Noncanonical tagged module version');
  const release=merged.get(info.Version);
  // A registry's old branch-origin receipt cannot establish the release tag.
  // Keep the independently published release; its builder resolves the tag.
  if(release&&Number.isFinite(Date.parse(info.Time))&&info.Origin?.VCS==='git'&&info.Origin.URL==='https://github.com/'+repository&&info.Origin.Ref==='refs/heads/main'&&/^[0-9a-f]{40}$/.test(info.Origin.Hash))continue;
  // Some deleted Wago canary tags retain a branch origin in the proxy.
  // Accept those only when the version itself names this exact commit hash.
  const canaryHash=info.Version.match(/-canary\.g([0-9a-f]{7,40})$/)?.[1];
  const namedCommit=repository==='wago-org/wago'&&info.Origin?.Ref==='refs/heads/main'&&canaryHash&&info.Origin.Hash?.startsWith(canaryHash);
  if(!Number.isFinite(Date.parse(info.Time))||info.Origin?.VCS!=='git'||info.Origin.URL!=='https://github.com/'+repository||(!namedCommit&&info.Origin.Ref!=='refs/tags/'+info.Version)||!/^[0-9a-f]{40}$/.test(info.Origin.Hash))throw Error('Module version lacks an exact timestamp and verifiable Git origin');
  if(release){release.revision=info.Origin.Hash;continue;}
  merged.set(info.Version,{tag_name:info.Version,published_at:info.Time,draft:false,prerelease:info.Version.includes('-'),html_url:'https://github.com/'+repository+'/commit/'+info.Origin.Hash,revision:info.Origin.Hash,datePrecision:'commit',dateBasis:'go-module-commit',versionTime:info.Time});
 }
 return [...merged.values()];
}
