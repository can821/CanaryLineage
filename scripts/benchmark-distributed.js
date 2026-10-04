import { performance } from 'node:perf_hooks';
import { platform,arch,cpus } from 'node:os';
import { createCanaryLineage,memoryTraceStore } from '../src/sdk/index.js';
import { startDistributed } from '../examples/distributed-fixture.js';
async function measure(name,operation,count=200){
  for(let i=0;i<10;i++)await operation(i);
  const start=performance.now(),heap=process.memoryUsage().heapUsed,samples=[];
  for(let i=0;i<count;i++){const t=performance.now();await operation(i);samples.push(performance.now()-t);}
  const elapsed=performance.now()-start;samples.sort((a,b)=>a-b);
  return {name,count,operationsPerSecond:Math.round(count*1000/elapsed),p50Ms:samples[Math.floor(count*.5)],p95Ms:samples[Math.floor(count*.95)],p99Ms:samples[Math.floor(count*.99)],parentHeapDeltaBytes:process.memoryUsage().heapUsed-heap};
}
const results=[];
for(const [count,events,depth] of [[1,1,0],[10,10,0],[1,10,4],[1,100,0]]){
  const sdk=createCanaryLineage({serviceName:'bench',storage:memoryTraceStore({limit:1000}),failureMode:'strict'});
  results.push(await measure(`memory: ${count} canaries, ${events} observations, ${depth} derivations`,()=>sdk.run({synthetic:true,canaries:Array.from({length:count},(_,i)=>({label:`c${i}`,value:`synthetic-${i}`}))},refs=>{
    let value=refs[0];for(let i=0;i<depth;i++)value=sdk.derive({parents:[value],label:`derived${i}`,value:`derived-${i}`,operation:'custom'});
    for(let i=0;i<events;i++)sdk.observe({type:'HTTP_INPUT',location:'request',canaries:[value]});
  })));
}
for(const disabled of [true,false]){
  const fixture=await startDistributed({disabled});
  try{results.push(await measure(disabled?'three-service HTTP: SDK disabled':'three-service HTTP: SDK enabled',i=>fixture.run({regression:true,suffix:`bench-${i}`}),100));}
  finally{await fixture.close();}
}
console.log(JSON.stringify({machine:`${platform()} ${arch()} ${cpus()[0]?.model}`,node:process.version,method:'One local sequential run; 10 warmups; 200 memory or 100 real HTTP requests. Disabled/enabled use the same three-service route and local analytics sink. No DB workload. Enabled includes evidence collection via IPC; parent heap excludes child processes and is GC-sensitive. Not production capacity.',results},null,2));
