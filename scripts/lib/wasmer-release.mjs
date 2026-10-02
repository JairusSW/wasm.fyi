// Published tag commits, resolved through the upstream annotated tag objects.
// Selection is explicit so old evidence never silently changes engine versions.
export const wasmerReleases={
  '7.3.0':{revision:'35c10644f7b0aad6fd9458624ceb8429fe7413c4',llvm:'22.1'},
  '7.4.2':{revision:'7a48a071c7682a409d148cf37dc8da58322a123d',llvm:'22.1'}
};
export function wasmerRelease(version='7.3.0') {
  const pin=wasmerReleases[version];
  if(!pin)throw Error('Unqualified Wasmer release: '+version);
  return {version,tag:'v'+version,...pin};
}
export function assertWasmerReceipt(receipt,pin,librarySha256) {
  if(receipt.version!==pin.version || receipt.revision!==pin.revision || receipt.librarySha256!==librarySha256)throw Error('Selected Wasmer SDK differs from its pinned build manifest');
  if(!receipt.llvm?.version?.startsWith(pin.llvm+'.'))throw Error('Selected Wasmer SDK has an unexpected LLVM version');
}
