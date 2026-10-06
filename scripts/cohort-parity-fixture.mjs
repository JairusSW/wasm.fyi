// Freeze current website point estimates and populations for the Go backend.
// These legacy fixtures test product-policy parity, not producer verification.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uri = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const measured = await readFile('src/lib/data/measurements.json', 'utf8');
const policySource = await readFile('src/lib/comparison-policy.ts', 'utf8');
const policyURI = uri(compile(policySource));
const providerSource = await readFile('src/lib/view-data.ts', 'utf8');
const providerURI = uri(compile(providerSource).replace(/import input from ['"]\.\/data\/measurements\.json['"];?/, () => `const input=${measured};`));
const aggregateSource = await readFile('src/lib/aggregates.ts', 'utf8');
const aggregateURI = uri(compile(aggregateSource)
	.replace(/['"]\.\/view-data['"]/g, () => JSON.stringify(providerURI))
	.replace(/['"]\.\/comparison-policy['"]/g, () => JSON.stringify(policyURI)));
const {viewData,viewCell} = await import(providerURI);
const {aggregate} = await import(aggregateURI);
const configs = viewData.applicationConfigurations;
const cases = [];
for (const machine of ['m1','m2']) {
	for (const weighting of ['workload','corpus']) {
		const workloads = viewData.catalogue.filter(w=>!w.id.startsWith('features/'));
		cases.push({name:`${machine}-steady-${weighting}`,
			input:{configurations:configs,baseline:'G',weighting,policy:'shared-geometric-v1',rows:workloads.map(w=>({
				key:`legacy-contract:${w.id}`,workload:w.id,group:w.group,cells:configs.map(c=>{
					const cell=viewCell(machine,'s1',w.id,c,'steady');
					return {configuration:c,result:`legacy-cell:${w.id}|${c}|steady`,report:cell.report,status:cell.st,value:cell.v??null};
				})}))},
			expected:configs.map(c=>{const a=aggregate({machine,baseline:'G',hide:{},weighting},'lat',c,3);return {configuration:c,value:a?.v??null,ratio:Number.isFinite(a?.r)?a.r:null,count:a?.count??0,reports:[...(a?.reports??[])].sort()};})});
	}
	cases.push({name:`${machine}-available-current-rss`,
		input:{configurations:configs,baseline:'G',weighting:'workload',policy:'available-rss-arithmetic-v1',rows:viewData.catalogue.flatMap(w=>['rssCurrentCompile','rssCurrentInst','rssCurrentFirst','rssCurrent'].map(m=>({
			key:`legacy-contract:${w.id}|${m}`,workload:w.id,group:w.group,cells:configs.map(c=>{const cell=viewCell(machine,'s1',w.id,c,m);return {configuration:c,result:`legacy-cell:${w.id}|${c}|${m}`,report:cell.report,status:cell.st,value:cell.v??null};})})))},
		expected:configs.map(c=>{const a=aggregate({machine,baseline:'G',hide:{},weighting:'workload'},'mem',c,3);
			// Legacy cards merge baseline reports; each population records its own.
			const reports=new Set(viewData.catalogue.flatMap(w=>['rssCurrentCompile','rssCurrentInst','rssCurrentFirst','rssCurrent'].map(m=>viewCell(machine,'s1',w.id,c,m))).filter(x=>x.st==='ok'&&x.report&&x.v>0&&Number.isFinite(x.v)).map(x=>x.report));
			return {configuration:c,value:a?.v??null,ratio:Number.isFinite(a?.r)?a.r:null,count:a?.count??0,reports:[...reports].sort()};})});
}
const fixture={schema:1,source:'legacy website projection; contract keys are fixture labels, not reconstructed producer contracts',measurementSha256:hash(measured),aggregateSourceSha256:hash(aggregateSource),policySourceSha256:hash(policySource),cases};
const output=JSON.stringify(fixture)+'\n';
const destination='service/testdata/cohort-current.json';
if (process.argv.includes('--write')) await writeFile(destination, output);
else if (await readFile(destination,'utf8')!==output) throw new Error('Cohort parity fixture changed; inspect source values and policies before --write');
console.log(`${cases.length} current-site comparison fixtures ${process.argv.includes('--write')?'written':'verified'}`);
