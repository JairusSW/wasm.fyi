// Mozilla's complete release ledger preserves ESR archive names in its keys.
export function firefoxReleases(document) {
 if(!document?.releases||typeof document.releases!=='object')throw Error('Mozilla release ledger missing');
 return Object.entries(document.releases).map(([key,row])=>{
  const tag=key.replace(/^firefox-/,'');
  if(!key.startsWith('firefox-')||!/^\d+(?:\.\d+)+(?:a\d+|b\d+|rc\d+|esr)?$/.test(tag)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date))throw Error('Malformed Mozilla release record: '+key);
  return {tag_name:tag,published_at:row.date+'T00:00:00Z',draft:false,prerelease:/(?:a|b|rc)\d+$/.test(tag),html_url:'https://archive.mozilla.org/pub/firefox/releases/'+tag+'/',datePrecision:'day'};
 });
}
