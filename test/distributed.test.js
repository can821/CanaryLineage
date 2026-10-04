import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanaryLineage, memoryTraceStore, parsePropagation, PROPAGATION_HEADER } from '../src/sdk/index.js';
import { startDistributed } from '../examples/distributed-fixture.js';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('three Node processes preserve distributed IDs, causal chain, transformations and concurrent isolation',async t=>{
  const fixture=await startDistributed();t.after(()=>fixture.close());
  const runs=await Promise.all(Array.from({length:6},(_,i)=>fixture.run({regression:i%2===0,suffix:String(i)})));
  assert.equal(new Set(runs.map(s=>s[0].id)).size,6);
  const allIds=runs.flat(2).flatMap(s=>s.events.map(e=>e.id));
  assert.equal(new Set(allIds).size,allIds.length);
  for(const segments of runs){
    assert.equal(new Set(segments.map(s=>s.id)).size,1);assert.equal(new Set(segments.map(s=>s.segmentId)).size,3);
    const events=segments.flatMap(s=>s.events);const gateway=segments.find(s=>s.serviceName==='gateway');
    const hash=gateway.canaries.find(c=>c.label==='email-sha256');
    for(const segment of segments){
      assert.equal(segment.canaries.find(c=>c.label==='email-sha256').id,hash.id);
      for(const event of segment.events){assert.equal(event.traceId,segment.id);assert.equal(event.segmentId,segment.segmentId);}
      if(segment.parentEventId){const parent=events.find(e=>e.id===segment.parentEventId);assert.equal(parent.type,'HTTP_OUTPUT');assert.equal(segment.events[0].parentId,parent.id);}
    }
    assert.equal(hash.depth,2);assert.equal(gateway.events.filter(e=>e.type==='TRANSFORMATION').length,2);
  }
  assert.equal(fixture.received.length,3);
});

test('propagation contains no raw values and rejects malformed, oversized, untrusted and extra fields',async t=>{
  let header;
  const server=createServer((req,res)=>{header=req.headers[PROPAGATION_HEADER];res.writeHead(204).end();});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const sdk=createCanaryLineage({serviceName:'source',distributed:true,failureMode:'strict',allowedOrigins:[origin]});
  await sdk.run({synthetic:true,canaries:[{label:'email',value:'controlled-private-value'}]},refs=>sdk.http({url:origin,targetService:'target',canaries:refs,body:'synthetic body'}));
  assert.ok(!Buffer.from(header,'base64url').toString().includes('controlled-private-value'));
  const context=parsePropagation(header,{trusted:true});assert.equal(context.sourceService,'source');
  for(const invalid of ['', '!!!','e30','x'.repeat(8193),header+'\r\nInjected:x'])assert.throws(()=>parsePropagation(invalid,{trusted:true}));
  assert.throws(()=>parsePropagation(header));
  for(const mutation of [{...context,version:99},{...context,extra:'untrusted'},{...context,canaries:[{...context.canaries[0],parentCanaryIds:[context.canaries[0].id]}]}])assert.throws(()=>parsePropagation(Buffer.from(JSON.stringify(mutation)).toString('base64url'),{trusted:true}));
  const strict=createCanaryLineage({serviceName:'target',distributed:true,failureMode:'strict'});
  await assert.rejects(strict.run({synthetic:true,canaries:[{label:'email',value:'test'}],propagation:'bad',trusted:true},()=>42),/Propagation rejected/);
  const open=createCanaryLineage({serviceName:'target',distributed:true});
  const fallback=await open.run({synthetic:true,canaries:[{label:'email',value:'test'}],propagation:'bad',trusted:true},()=>42);
  assert.equal(fallback.result,42);assert.equal(fallback.trace.incomplete,true);
  const missing=await open.run({synthetic:true,canaries:[{label:'email',value:'test'}]},()=>42);assert.equal(missing.trace.incomplete,false);
});

test('distributed memory storage keeps same-trace segments without overwriting',async()=>{
  const store=memoryTraceStore();
  await store.saveTrace({id:'shared',segmentId:'a'});await store.saveTrace({id:'shared',segmentId:'b'});
  assert.equal((await store.getSegments('shared')).length,2);
});

test('HTTP target guards and timeouts preserve host failure and bounded incomplete propagation evidence',async t=>{
  const server=createServer((_req,res)=>{const timer=setTimeout(()=>res.end(),100);res.on('close',()=>clearTimeout(timer));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;const store=memoryTraceStore();let traceId;
  const sdk=createCanaryLineage({serviceName:'timeouts',distributed:true,storage:{mode:'memory-demo',async saveTrace(trace){traceId=trace.id;await store.saveTrace(trace);},getTrace:store.getTrace},allowedOrigins:[origin],failureMode:'strict'});
  await assert.rejects(sdk.run({synthetic:true,canaries:[{label:'email',value:'synthetic'}]},refs=>sdk.http({url:origin,targetService:'target',canaries:refs,timeoutMs:10})),e=>e.name==='TimeoutError');
  assert.equal((await store.getSegments(traceId))[0].events[0].status,'failed');
  await assert.rejects(sdk.run({synthetic:true,canaries:[{label:'email',value:'synthetic'}]},refs=>sdk.http({url:'http://example.test',targetService:'other',canaries:refs})),/rejected/);
  const bounded=createCanaryLineage({serviceName:'bounded',distributed:true,limits:{maxPropagationBytes:1},allowedOrigins:[origin]});
  const limited=await bounded.run({synthetic:true,canaries:[{label:'email',value:'synthetic'}]},refs=>bounded.http({url:origin,targetService:'target',canaries:refs,timeoutMs:1000}));
  await limited.result.body.cancel();assert.equal(limited.trace.incomplete,true);
  const queue=createCanaryLineage({serviceName:'worker',distributed:true});
  const bad=await queue.run({synthetic:true,transport:'queue',propagation:'broken',trusted:true,canaries:[{label:'email',value:'synthetic'}]},()=>42);
  assert.equal(bad.result,42);assert.equal(bad.trace.incomplete,true);
});
