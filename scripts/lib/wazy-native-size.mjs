export function wazyNativeSizeLayout(paths){
 if(paths.has('internal/engine/native/engine.go'))return 'native';
 if(paths.has('internal/engine/wazevo/engine.go'))return 'unavailable-wazevo';
 throw Error('Pinned Wazy native-size source layout is unknown');
}
