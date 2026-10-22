import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('Chasm extended-name declarations cover only implemented subsection probes',()=>{
 const d={runtime:'chasm',backend:'jvm-interpreter',runtime_version:'02033f247459790dd46da3d5b104c0c11bc36bd7',features:['extended-name-section']};
 const feature='extended-name-section',path=name=>`features/${feature}/${name}-name/4096`;
 for(const name of ['label','type','table','memory','global','field','tag'])assert.equal(runtimeDeclaresFeature(d,feature,path(name)),true);
 for(const name of ['element','data','unknown'])assert.equal(runtimeDeclaresFeature(d,feature,path(name)),false);
 assert.equal(runtimeDeclaresFeature(d,feature),false);
 for(const change of [{features:[]},{backend:'other'},{runtime_version:'a'.repeat(40)}])assert.equal(runtimeDeclaresFeature({...d,...change},feature,path('type')),false);
});
