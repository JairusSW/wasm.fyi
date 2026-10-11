function valueSpans(text){
 const spans=new Map();let cursor=0;
 const white=()=>{while(/\s/.test(text[cursor]||'')&&cursor<text.length)cursor++;};
 const string=()=>{const start=cursor++;while(cursor<text.length){const ch=text[cursor++];if(ch==='\\')cursor++;else if(ch==='"')return JSON.parse(text.slice(start,cursor));}throw Error('Unterminated JSON string');};
 function value(path){white();const start=cursor,ch=text[cursor];
  if(ch==='{'){cursor++;white();const keys=new Set();if(text[cursor]!=='}')for(;;){white();if(text[cursor]!=='"')throw Error('Invalid JSON key');const key=string();if(keys.has(key))throw Error('Duplicate JSON key');keys.add(key);white();if(text[cursor++]!==':')throw Error('Invalid JSON member');value([...path,key]);white();if(text[cursor]!==',')break;cursor++;}if(text[cursor++]!=='}')throw Error('Invalid JSON object');}
  else if(ch==='['){cursor++;white();let index=0;if(text[cursor]!==']')for(;;){value([...path,index++]);white();if(text[cursor]!==',')break;cursor++;}if(text[cursor++]!==']')throw Error('Invalid JSON array');}
  else if(ch==='"')string();
  else{while(cursor<text.length&&!/[\s,\]}]/.test(text[cursor]))cursor++;if(cursor===start)throw Error('Invalid JSON value');JSON.parse(text.slice(start,cursor));}
  spans.set(JSON.stringify(path),{start,end:cursor});
 }
 value([]);white();if(cursor!==text.length)throw Error('Trailing JSON bytes');return spans;
}

export function normalizeFeatureCaptureMetadata(originalBytes,memoryBytes){
 const original=Buffer.from(originalBytes),text=original.toString('utf8');if(!original.equals(Buffer.from(text)))throw Error('Invalid UTF8 capture');
 const body=JSON.parse(text);if(!body.results?.length||!body.results.every(r=>r.workload.startsWith('features/')))throw Error('Feature capture required');
 if(!Number.isSafeInteger(memoryBytes)||memoryBytes<=0)throw Error('Known physical memory required');
 if(body.platform.memoryBytes>0&&body.platform.memoryBytes!==memoryBytes)throw Error('Existing memory metadata conflicts');
 const spans=valueSpans(text),platform=spans.get(JSON.stringify(['platform'])),memory=spans.get(JSON.stringify(['platform','memoryBytes']));let after=text;
 if(body.platform.memoryBytes!==memoryBytes){
  if(memory)after=text.slice(0,memory.start)+String(memoryBytes)+text.slice(memory.end);
  else after=text.slice(0,platform.end-1)+',"memoryBytes":'+memoryBytes+text.slice(platform.end-1);
 }
 if(body.featureCompatibility===true){const changed=after.replace(/,\s*"featureCompatibility"\s*:\s*true(?=\s*\}\s*$)/,'');if(changed===after)throw Error('Compatibility marker position unexpected');after=changed;}
 const actual=JSON.parse(after);if(actual.platform.memoryBytes!==memoryBytes||Object.hasOwn(actual,'featureCompatibility'))throw Error('Metadata normalization incomplete');
 return Buffer.from(after);
}
