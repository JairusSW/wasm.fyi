import { COMPAT } from './data/features';
import { describe, expect, it } from 'vitest';
import { ALLB } from './data/snapshot';
import { CFG } from './data/runtimes';
import { fmtU, fmtUGroup, fx, pct, relative } from './format';
import { heatCount, heatRatio } from './heat';
import { benchVal, compatCell, isVisible, kidCells, leader, ratio, seriesFmt, type Scope } from './model';
import { viewData } from './view-data';

const scope: Scope = { machine: 'm1', baseline: 'G', weighting: 'corpus', hide: {} };

describe('format', () => {
	it('expresses the same ratio as a multiplier or signed percentage',()=>{
		expect(relative(1.3)).toBe('+30.0%');
		for(const [value,factor,percent] of [[1.3,'1.30×','+30.0%'],[.7,'0.70×','−30.0%'],[1,'1.00×','±0.0%'],[0,'0.00×','−100.0%']] as const){
			expect(relative(value,'factor')).toBe(factor);
			expect(relative(value,'percent')).toBe(percent);
		}
	});
	it('changes only the presentation of history deltas, preserving direction and count units',()=>{
		const factor=seriesFmt('exec','factor').chg(7,10),percent=seriesFmt('exec','percent').chg(7,10);
		expect(factor).toEqual({t:'0.70×',good:true,flat:false});
		expect(percent).toEqual({...factor,t:'−30.0%'});
		expect(seriesFmt('cov','factor').chg(12,10)).toEqual(seriesFmt('cov','percent').chg(12,10));
	});
	it('rescales units', () => {
		expect(fmtU(0.0049, 'ms')).toBe('4.9 µs');
		expect(fmtU(0.00001, 'ms')).toBe('10 ns');
		expect(fmtU(0.000001, 'ms')).toBe('1 ns');
		expect(fmtU(0.0000001, 'ms')).toBe('0.1 ns');
		expect(fmtU(41.2, 'ms')).toBe('41.2 ms');
		expect(fmtU(1500, 'ms')).toBe('1.5 s');
		expect(fmtU(2048, 'KB')).toBe('2.00 MB');
		expect(fmtU(0.49, 'KiB')).toBe('502 B');
		expect(fmtU(1.25, 'KiB')).toBe('1,280 B');
		expect(fmtU(1.5, 'KiB')).toBe('1.5 KiB');
	});
	it('shares a useful time unit across adjacent values where their range allows it',()=>{
		expect(fmtUGroup([0.0008,0.0012],'ms')).toEqual(['800 ns','1200 ns']);
		expect(fmtUGroup([0.00001,0.5],'ms')).toEqual(['10 ns','500 µs']);
	});
	it('formats ratios and deltas', () => {
		expect(fx(1.234)).toBe('1.23×');
		expect(fx(28.4)).toBe('28.4×');
		expect(pct(-0.031)).toBe('−3.1%');
		expect(pct(0)).toBe('±0.0%');
	});
});

describe('engine classes',()=>{
	it('classifies the selected measured backend rather than every capability an engine offers',()=>{
		const byId=Object.fromEntries(CFG.map(c=>[c.id,c]));
		expect(CFG.some(c=>c.interp)).toBe(false);
		expect(['A','D','E','F','G','L'].every(id=>!byId[id].interp)).toBe(true);
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
	it('shows Wago with its sealed source identity while hiding hash-pinned development builds', () => {
		expect(isVisible(scope, { id: 'G', rt: 'wago' } as any)).toBe(true);
		expect(isVisible(scope, { id: 'F', rt: 'v8' } as any)).toBe(false);
	});
	it('keeps uncollected WAVM outside measured benchmark tables',()=>{
		expect(viewData.hosts.m1.configurations.L).toBeUndefined();
		expect(isVisible(scope,{id:'L',rt:'wavm'} as any)).toBe(false);
	});
	it('baseline ratio is 1', () => {
		expect(ratio(scope, 'lat', 'G', 3)!.r).toBe(1);
	});
    it('keeps unavailable code collectors distinct from true zero', () => {
      const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
		expect(benchVal(scope,b,'D','code').st).toBe('unavail');
    });
    it('reads Wago measurements on the actual Mac rather than a machine multiplier', () => {
      const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
      expect(benchVal({...scope,machine:'m2'},b,'G','steady').st).toBe('ok');
    });
    it('never scales a measurement into an uncollected input case', () => {
		expect(benchVal(scope,ALLB[0],'G','steady',2).st).toBe('nm');
    });
	it('reports no clear leader when intervals overlap', () => {
		const single={...scope,hide:{B:true,C:true,D:true,E:true,F:true,G:true,H:true}};
        expect(leader(single, 'Fastest compilation', 'lat', 0, 'compile').clear).toBe(false);
	});
    for(const machine of ['m1','m2'] as const)it(`ranks the measured Wago execution mean and respects hiding on ${machine}`,()=>{
        const selected={...scope,machine,hide:{}};
        const result=leader(selected,'Fastest execution','lat',3,'steady');
        expect(result.places.map(p=>p.cfg.id)).toEqual(['G']);
        expect(result.places[0].ratio).toBe(ratio(selected,'lat','G',3)!.r);
        expect(leader({...selected,hide:{G:true}},'Fastest execution','lat',3,'steady').places).toHaveLength(0);
    });
    it('does not fabricate feature corpus outcomes when features were excluded',()=>{
        const cell=compatCell('core-mem','G',scope);
        expect(cell.total).toBe(0);expect(cell.run).toBe(false);
        expect(compatCell('uncollected-family','G',scope).run).toBe(false);
    });
});
