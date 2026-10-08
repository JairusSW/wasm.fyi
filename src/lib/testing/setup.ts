import {vi} from 'vitest';
// Existing numerical parity tests retain their explicit legacy fixture.
vi.mock('../view-data',()=>import('./legacy-view-data'));
