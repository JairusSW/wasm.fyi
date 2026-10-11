// Source-supported compiler policy; the selected engine and mode stay unchanged.
export function wizardSPCGlobalCommand(command, configuration) {
 if(configuration!=='wizard-spc')return [...command];
 if(!command.includes('--mode=spc'))throw Error('Wizard SPC mode identity missing');
 const prior=command.filter(x=>x.startsWith('--inline-global-access='));
 if(prior.some(x=>x!=='--inline-global-access=false'))throw Error('Conflicting Wizard global policy');
 return prior.length?[...command]:[...command.slice(0,-1),'--inline-global-access=false',command.at(-1)];
}
export function wizardGlobalPolicyDescription(source) {
 const field='.str("inline_global_access", if(SpcTuning.inlineGlobalAccess, "true", "false"))';
 if(source.includes(field))return source;
 const boolean='.boo("inline_global_access", SpcTuning.inlineGlobalAccess)';
 if(source.includes(boolean))return source.replace(boolean,field);
 const seam='.str("mode", mode).build();';
 if(source.split(seam).length!==2)throw Error('Unknown Wizard description seam');
 return source.replace(seam,'.str("mode", mode)'+field+'.build();');
}
