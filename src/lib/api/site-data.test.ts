import {it,expect} from 'vitest';
import {SiteDataset} from './site-data';
it('availability sends scientific selectors without display conversion fields',async()=>{
 const revision='a'.repeat(64);let observed!:URL;
 const request=(async (input:RequestInfo|URL)=>{
  observed=new URL(String(input));
  return new Response(JSON.stringify({revision,items:[],workloads:0}),{headers:{'Content-Type':'application/json'}});
 }) as typeof fetch;
 const client=SiteDataset.fromRevision(revision,'https://fixture.test',request);
 const selector={metric:'time.wall',scenario:'steady',statistic:'median_ns_per_operation',factor:1e6};
 await client.availability('b'.repeat(64),[],'current',undefined,selector);
 expect(observed.searchParams.has('factor')).toBe(false);
 expect(observed.searchParams.get('metric')).toBe('time.wall');
 expect(observed.searchParams.get('scenario')).toBe('steady');
 expect(observed.searchParams.get('profile')).toBe('timing');
 expect(observed.searchParams.get('revision')).toBe(revision);
 expect(observed.searchParams.get('version')).toBe('availability-v3');
 client.close();
});
