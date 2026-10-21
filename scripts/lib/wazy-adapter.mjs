export function adaptWazyCoreFeatures(source,featureDefinitions){
 if(featureDefinitions.includes('CoreFeaturesV3'))return {source,policy:'core-features-v3'};
 const seam='api.CoreFeaturesV3|experimental.CoreFeaturesThreads';
 if(!source.includes(seam))throw Error('Wazy core-feature adapter seam changed');
 if(!featureDefinitions.includes('CoreFeaturesV2'))throw Error('Pinned Wazy source declares neither CoreFeaturesV2 nor CoreFeaturesV3');
 return {source:source.replaceAll(seam,'api.CoreFeaturesV2|experimental.CoreFeaturesThreads'),policy:'core-features-v2-plus-threads'};
}

export function adaptWazyComponents(source,hasComponentPackage){
 if(hasComponentPackage)return {source,policy:'component-enabled'};
 const importSeam='\t"github.com/samyfodil/wazy/component"\n';
 const start='\t\tif w.ABI == "component" {';
 const end='\t\tif w.Oracle.Kind == "exact_vectors" {';
 const prepare='(w.ABI != "core" && w.ABI != "component")';
 const oracles='[]string{"exact_u64", "exact_vectors", "component_compile_only"}';
 for(const seam of [importSeam,start,end,prepare,oracles,'[]string{"core", "component"}'])if(!source.includes(seam))throw Error('Wazy component adapter seam changed');
 const begin=source.indexOf(start),finish=source.indexOf(end,begin);
 source=source.slice(0,begin)+source.slice(finish);
 source=source.replace(importSeam,'').replace(prepare,'w.ABI != "core"').replace(oracles,'[]string{"exact_u64", "exact_vectors"}').replace('[]string{"core", "component"}','[]string{"core"}');
 return {source,policy:'core-only-component-package-unavailable'};
}
