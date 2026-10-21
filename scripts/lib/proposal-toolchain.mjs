import {homedir,platform,arch} from 'node:os';
import {join} from 'node:path';
export const proposalToolchainRoot=join(homedir(),'.local/share/wasm-fyi/toolchains/v8-15.2.20',`${platform()}-${arch()}`);
export const proposalToolchains={
 'linux-x64':{file:'v8-linux64-rel-15.2.20.zip',sha256:'dd6945f95b27083fa74a6b2324ad307c662a1fd0b712a3ad6d6e9be111cfe010'},
 'darwin-arm64':{file:'v8-mac-arm64-rel-15.2.20.zip',sha256:'91dcb129ead8b0587e7c7a5085c1b44168936abaaab121632fdc5e8a459531ba'},
};
