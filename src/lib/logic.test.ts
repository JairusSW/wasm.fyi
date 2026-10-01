import { COMPAT } from './data/features';
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
	for(const machine of ['m1','m2'] as const)it(`ranks the first three measured execution means and respects hidden configurations on ${machine}`,()=>{
		const selected={...scope,machine,hide:{G:true}};
		const result=leader(selected,'Fastest execution','lat',3,'steady');
		expect(result.places).toHaveLength(3);
		expect(result.places.map(p=>p.place)).toEqual([1,2,3]);
		expect(result.places.some(p=>p.cfg.id==='G')).toBe(false);
		for(const [i,p] of result.places.entries()){
			expect(p.ratio).toBe(ratio(selected,'lat',p.cfg.id,3)!.r);
			if(i)expect(p.ratio).toBeGreaterThanOrEqual(result.places[i-1].ratio);
		}
	});
	it('counts exact corpus children without assigning fabricated failures', () => {
    const fam=COMPAT.flatMap(s=>s.fams).find(f=>f.id==='core-mem')!;
    const cell=compatCell(fam.id,'A',scope);
    const kids=kidCells(fam,0,scope);
    for(const field of ['total','pass','fail','crash','skip'] as const)expect(kids.reduce((sum,k)=>sum+k[field],0)).toBe(cell[field]);
    expect(compatCell('uncollected-family','A',scope).run).toBe(false);
  });
});
