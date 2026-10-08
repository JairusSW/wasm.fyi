export function machineLabel(cpu:string):string {
 const apple=cpu.match(/Apple\s+(M\d+)\s*(Max|Pro|Ultra)?/i);
 if(apple)return ['Apple',apple[1].toUpperCase(),apple[2]?.toUpperCase()].filter(Boolean).join(' ');
 const ryzen=cpu.match(/AMD Ryzen\s+(?:\d\s+)?([\d]+[A-Za-z0-9]*)/i);
 if(ryzen)return 'AMD Ryzen '+ryzen[1].toUpperCase();
 return cpu.replace(/\s+\d+-Core Processor$/i,'').trim();
}
