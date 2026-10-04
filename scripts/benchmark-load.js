import { performance } from 'node:perf_hooks';
import { platform,arch,cpus } from 'node:os';
import { startDistributed } from '../examples/distributed-fixture.js';
import { buildGraph } from '../src/analysis/graph.js';
const results=[];
for(const [requests,concurrency] of [[100,1],[1000,10],[1000,25]]){
  // Alternate order to reduce systematic warmup bias; still one local measurement.
  for(const disabled of concurrency===10?[false,true]:[true,false]){
    const fixture=await startDistributed({disabled});
    try{
      for(let i=0;i<10;i++)await fixture.run({regression:true,suffix:`warm-${i}`});
      const before=process.memoryUsage().heapUsed;let next=0,errors=0,events=0;const samples=[];const start=performance.now();
      await Promise.all(Array.from({length:concurrency},async()=>{
        while(next<requests){const index=next++;const t=performance.now();
          try{const segments=await fixture.run({regression:true,suffix:`load-${index}`});if(!disabled){const graph=buildGraph(segments);if(!graph.complete)throw Error('incomplete');events+=graph.nodes.events.length;}}
          catch{errors++;}finally{samples.push(performance.now()-t);}
        }
      }));
      const elapsedMs=performance.now()-start;samples.sort((a,b)=>a-b);
      results.push({mode:disabled?'SDK disabled':'distributed memory + graph validation',requests,concurrency,errors,errorRate:errors/requests,events,throughput:requests*1000/elapsedMs,p50Ms:samples[Math.floor(requests*.5)],p95Ms:samples[Math.floor(requests*.95)],p99Ms:samples[Math.floor(requests*.99)],parentHeapDeltaBytes:process.memoryUsage().heapUsed-before});
    }finally{await fixture.close();}
  }
}
console.log(JSON.stringify({hardware:cpus()[0]?.model,os:platform(),arch:arch(),node:process.version,method:'Real loopback gateway/users/processor/analytics, two canaries and two transformations; 10 sequential warmups per workload; bounded concurrency. Enabled includes IPC collection and graph validation. In-memory fixture retains evidence, heap is parent-only and GC-sensitive. PostgreSQL/Redis not included. Not production capacity.',results},null,2));
if(results.some(r=>r.errors))process.exitCode=1;
