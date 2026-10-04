import { performance } from 'node:perf_hooks';
import { createCanaryLineage } from '../src/sdk/index.js';
const count = 2000;
const sdk = createCanaryLineage({ serviceName: 'benchmark', failureMode: 'strict' });
const baseline = async () => 'synthetic-value';
const traced = () => sdk.run({ synthetic: true, canaries: [{ label: 'sample', value: 'synthetic-value' }] }, ([ref]) => {
  sdk.observe({ type: 'HTTP_INPUT', location: 'input', canaries: [ref] });
  return ref.value;
});
async function measure(operation) {
  const samples = [];
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i=0; i<count; i++) { const t=performance.now(); await operation(); samples.push(performance.now()-t); }
  const elapsed = performance.now()-start;
  samples.sort((a,b)=>a-b);
  return { iterations: count, operationsPerSecond: Math.round(count*1000/elapsed), p50Ms: samples[Math.floor(count*.5)], p95Ms: samples[Math.floor(count*.95)], heapDeltaBytes: process.memoryUsage().heapUsed-before };
}
for (let i=0; i<200; i++) { await baseline(); await traced(); }
console.log(JSON.stringify({ methodology: 'Sequential in-process microbenchmark; 200 warmup iterations, 2000 measured each. SDK includes UUID/context/event/snapshot; no HTTP sockets, DB or persistence. GC and ordering affect heap delta and latency; not production capacity.', node: process.version, baseline: await measure(baseline), sdk: await measure(traced), eventsPerTrace: 1 },null,2));
