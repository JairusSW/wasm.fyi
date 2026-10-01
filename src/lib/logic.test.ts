import { describe, expect, it } from 'vitest';
import { ALLB } from './data/snapshot';
import { fmtU, fx, pct } from './format';
import { heatCount, heatRatio } from './heat';
import { benchVal, compatCell, kidCells, leader, ratio, type Scope } from './model';

const scope: Scope = { machine: 'm1', baseline: 'A', weighting: 'corpus', hide: {} };

describe('format', () => {
	it('rescales units', () => {
		expect(fmtU(0.0049, 'ms')).toBe('4.9 µs');
		expect(fmtU(41.2, 'ms')).toBe('41.2 ms');
		expect(fmtU(1500, 'ms')).toBe('1.50 s');
		expect(fmtU(2048, 'KB')).toBe('2.00 MB');
	});
	it('formats ratios and deltas', () => {
		expect(fx(1.234)).toBe('1.23×');
		expect(fx(28.4)).toBe('28.4×');
		expect(pct(-0.031)).toBe('−3.1%');
		expect(pct(0)).toBe('±0.0%');
	});
});

describe('heat scale', () => {
	it('leaves near-equal ratios transparent', () => {
		expect(heatRatio(1.01)).toBe('transparent');
		expect(heatRatio(null)).toBe('transparent');
	});
	it('uses good / mid / bad hues and caps alpha', () => {
		expect(heatRatio(0.5)).toContain(' 165 ');
		expect(heatRatio(1.3)).toContain(' 90 ');
		expect(heatRatio(100)).toBe('oklch(0.74 0.12 30 / 0.340)');
		expect(heatCount(0)).toContain(' 165 ');
		expect(heatCount(0.9)).toContain(' 30 ');
	});
});

describe('model', () => {
	it('baseline ratio is 1', () => {
		expect(ratio(scope, 'lat', 'A', 3)!.r).toBe(1);
	});
    it('keeps unavailable code collectors distinct from true zero', () => {
      const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
      expect(benchVal(scope,b,'C','code').st).toBe('nm');
    });
    it('reads Singlepass measurements on the actual Mac rather than a machine multiplier', () => {
      const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
      expect(benchVal({...scope,machine:'m2'},b,'D','steady').st).toBe('ok');
    });
    it('never scales a measurement into an uncollected input case', () => {
      expect(benchVal(scope,ALLB[0],'C','steady',2).st).toBe('nm');
    });
	it('reports no clear leader when intervals overlap', () => {
		const single={...scope,hide:{B:true,C:true,D:true,E:true,F:true,G:true}};
        expect(leader(single, 'Fastest compilation', 'lat', 0, 'compile').clear).toBe(false);
	});
	it('splits spec results consistently', () => {
		const c = compatCell(3210, 'd:.991:c2');
		expect(c.pass + c.fail + c.crash + c.skip).toBe(3210);
		const fam = { id: 'core-mem', total: 3210, kids: [['a', 0.58], ['b', 0.29], ['c', 0.13]] as [string, number][], r: ['d:.991:c2'] };
		const kids = kidCells(fam, 0);
		expect(kids.reduce((a, k) => a + k.total, 0)).toBe(3210);
		expect(kids.reduce((a, k) => a + k.fail, 0)).toBe(c.fail);
	});
});
