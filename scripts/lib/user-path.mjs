import {homedir} from 'node:os';
import {join} from 'node:path';
// Campaigns retain existing paths. The local CLI opts into one private root.
export function userPath(legacy){
 const root=process.env.WASMFYI_HOME;
 if(!root)return join(homedir(),legacy);
 for(const prefix of ['.cache/wasm-fyi/','.local/share/wasm-fyi/'])if(legacy.startsWith(prefix))return join(root,'cache',legacy.slice(prefix.length));
 if(legacy==='.cache/wasm-fyi')return join(root,'cache');
 throw Error('Unknown managed path: '+legacy);
}
