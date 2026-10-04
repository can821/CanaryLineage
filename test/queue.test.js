import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCanaryLineage } from '../src/sdk/index.js';
import { buildGraph } from '../src/analysis/graph.js';
import { compareGraphs } from '../src/analysis/diff.js';

test('delayed concurrent IPC jobs restore canaries and derivations in a separate worker process',async t=>{
  const server=createServer((req,res)=>{req.resume();req.on('end',()=>res.writeHead(204).end());});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const worker=fork(new URL('./fixtures/queue-worker.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc']});
  t.after(async()=>{worker.kill();await once(worker,'exit');});
  const pending=new Map();worker.on('message',m=>{pending.get(m.id)?.(m);pending.delete(m.id);});
  let sequence=0;const job=data=>new Promise((resolve,reject)=>{const id=String(++sequence);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Worker timeout'));},5000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});worker.send({id,...data});});
  const url=`http://127.0.0.1:${server.address().port}/sink`;
  const sdk=createCanaryLineage({serviceName:'producer',distributed:true,failureMode:'strict'});
  const all=await Promise.all(Array.from({length:5},async(_,i)=>{
    const produced=await sdk.run({synthetic:true,canaries:[{label:'email',value:`synthetic-${i}`},{label:'customer',value:`customer-${i}`}]},([email,customer])=>{
      const hash=sdk.derive({parents:[email],label:'hash',value:`explicit-derived-${i}`,operation:'custom'});
      return {context:sdk.createJobContext({targetService:'worker',canaries:[hash,customer]}),hash:hash.value,customer:customer.value};
    });
    // Producer run has already ended; consumer starts later in another process.
    const consumed=await job({...produced.result,url});assert.ok(!consumed.error);
    const graph=buildGraph([produced.trace,consumed.trace]);assert.equal(graph.complete,true);
    assert.ok(graph.edges.some(e=>e.type==='CONSUMED_BY'));
    assert.deepEqual(consumed.trace.canaries.find(c=>c.label==='hash').parentCanaryIds,[produced.trace.canaries[0].id]);
    const without=structuredClone(produced.trace);without.events=without.events.filter(e=>e.type!=='QUEUE_PRODUCER');
    assert.ok(compareGraphs(without,[produced.trace,consumed.trace]).changes.some(c=>c.type==='NEW_QUEUE_HOP'));
    return graph.traceId;
  }));assert.equal(new Set(all).size,5);
  assert.equal((await job({url,hash:'synthetic',customer:'synthetic',context:'bad'})).error,'Job rejected');
  const missing=await job({url,hash:'synthetic',customer:'synthetic'});assert.ok(missing.trace);assert.equal(missing.trace.parentEventId,null);
});
