// Curated execution kernels are original implementations, separate from the
// attributed upstream semantic checks in upstream/. A size is not a workload.
import {fixtures as core} from './curated-core.mjs';
import {fixtures as memory} from './curated-memory.mjs';
import {fixtures as proposals} from './curated-proposals.mjs';
import {fixtures as access} from './curated-access.mjs';
import {fixtures as components} from './curated-components.mjs';
export function curatedFixtures() {
  return [...core(), ...memory(), ...proposals(), ...access(), ...components()].map(f=>({...f,wat:f.wat.replace(/[ \t]+$/gm,'')}));
}
