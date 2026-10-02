// Only schedule official-suite runners when the engine had a published release.
// A missing release is different from a release whose runner is not implemented.
export function historyLanes(pins, targetWeek, platform) {
  const lanes=[],gaps=[];
  for(const pin of pins.filter(p=>p.targetWeek===targetWeek)) {
    if(pin.status!=='planned') {
      gaps.push({...pin,status:'unavailable'});
    } else if(pin.engine==='wasmtime') {
      lanes.push('wasmtime-core','winch-core','wasmtime-component','wasmtime-wasi');
    } else if(pin.engine==='wago') {
      lanes.push('wago-core','wago-component');
      if(platform==='linux')lanes.push('wago-wasi');
      else gaps.push({...pin,status:'uncollected',scope:'wasi',reason:'The released official WASI runner requires Linux; collect this lane on Hub.'});
    } else {
      gaps.push({...pin,status:'uncollected',reason:'A qualified official-suite release runner is not implemented for this engine.'});
    }
  }
  return {lanes,gaps};
}
