/** Extra correctness inputs stay separate from the timed benchmark inventory. */
export function featureValidationSizes(fixture) {
 const largest=Math.max(...fixture.sizes);
 const sizes=new Set(fixture.sizes.flatMap(n=>[n-1,n,n+1]).filter(n=>n>=1&&n<=largest));
 // Allocation kernels explicitly support growing by zero pages. Loop and
 // last-byte kernels require positive input, so zero is not a universal case.
 if(fixture.scope==='allocation')sizes.add(0);
 return [...sizes].sort((a,b)=>a-b);
}
export function featureValidationWorkload(fixture,size,template) {
 const component=fixture.abi==='component';
 return {...template,id:`features/${fixture.feature}/${fixture.name}/validation-${size}`,
  args:fixture.args?fixture.args(size):[component?String(size):size],
  oracle:fixture.oracle?fixture.oracle(size):{kind:'exact_u64',expected:[component?String(fixture.expected(size)):fixture.expected(size)]},
  ...(fixture.command?{command:fixture.command(size)}:{}),
  provenance:{...template.provenance,validationOnly:true,validationSize:size}};
}
