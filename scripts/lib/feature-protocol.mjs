// Native adapters require decimal u64 strings at the protocol boundary. Keep
// numeric corpus manifests intact, and reject numbers that already lost bits.
const maxU64=(1n<<64n)-1n;
const decimalU64=value=>{
 if(typeof value==='number' && (!Number.isSafeInteger(value)||value<0))throw Error('Feature value is not a lossless u64');
 if(typeof value!=='number' && typeof value!=='string')throw Error('Feature value must be a number or decimal string');
 const text=String(value);
 if(!/^\d+$/.test(text)||BigInt(text)>maxU64)throw Error('Feature value is outside u64');
 return text;
};
export function featureProtocolWorkload(workload){
 return {...workload,args:workload.args?.map(decimalU64),oracle:{...workload.oracle,expected:workload.oracle?.expected?.map(decimalU64)}};
}
