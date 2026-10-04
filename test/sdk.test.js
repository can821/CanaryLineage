import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createCanaryLineage, memoryTraceStore, compareTraces } from '../src/sdk/index.js';
const inputs = [{ label: 'email', value: 'canary@example.test' }, { label: 'phone', value: 'synthetic-phone-1' }];
const storage = { table: 'users', column: 'email_hash', operation: 'INSERT' };

test('SDK multi-canary derivation preserves parents and traces derived destinations', async () => {
  const store = memoryTraceStore();
  const sdk = createCanaryLineage({ serviceName: 'users', storage: store, failureMode: 'strict' });
  const { trace, traceSaved } = await sdk.run({ synthetic: true, canaries: inputs }, ([email, phone]) => sdk.span('register', [email, phone], async () => {
    const hashed = sdk.derive({ parents: [email], label: 'email-sha256', value: createHash('sha256').update(email.value).digest('hex'), operation: 'sha256' });
    sdk.observe({ type: 'DATABASE_WRITE', location: 'users.email_hash', canaries: [hashed], metadata: storage, status: 'success' });
    sdk.observe({ type: 'HTTP_OUTPUT', location: 'mail', canaries: [hashed, phone], metadata: { destination: 'local-mail', method: 'POST', path: '/send' } });
  }));
  assert.equal(trace.schemaVersion, 2); assert.equal(traceSaved, true);
  assert.equal(trace.canaries.length, 3);
  assert.deepEqual(trace.canaries[2].parentCanaryIds, [trace.canaries[0].id]);
  assert.equal(trace.events[1].type, 'TRANSFORMATION');
  assert.deepEqual(trace.events[2].canaryIds, [trace.canaries[2].id]);
  assert.equal(trace.events[2].parentId, trace.events[0].id);
  assert.ok(trace.events.every(e => e.serviceName === 'users' && !('value' in e)));
  const saved = await store.getTrace(trace.id); saved.events.length = 0;
  assert.equal((await store.getTrace(trace.id)).events.length, 4);
});

test('SDK concurrent traces and parallel sibling spans isolate context and foreign handles', async () => {
  const sdk = createCanaryLineage({ serviceName: 'concurrent', failureMode: 'strict' });
  let foreign;
  const first = await sdk.run({ synthetic: true, canaries: inputs }, ([email]) => { foreign = email; });
  const runs = await Promise.all(Array.from({ length: 12 }, (_, i) => sdk.run({ synthetic: true, canaries: [{ label: 'email', value: `synthetic-${i}` }] }, async ([email]) => {
    assert.throws(() => sdk.observe({ type: 'HTTP_OUTPUT', location: 'wrong', canaries: [foreign] }));
    await Promise.all(['one', 'two'].map(name => sdk.span(name, [email], async () => {
      await delay(2);
      sdk.observe({ type: 'DATABASE_WRITE', location: name, canaries: [email], metadata: storage });
    })));
  })));
  assert.equal(new Set([first, ...runs].map(r => r.trace.id)).size, 13);
  for (const { trace } of runs) {
    assert.equal(trace.events.length, 4);
    for (const e of trace.events.filter(e => e.type === 'DATABASE_WRITE')) {
      assert.equal(trace.events.find(parent => parent.id === e.parentId).location, e.location);
      assert.deepEqual(e.canaryIds, [trace.canaries[0].id]);
    }
  }
});

test('SDK compares overall or one stable canary label across executions', async () => {
  const sdk = createCanaryLineage({ serviceName: 'compare', failureMode: 'strict' });
  const run = enabled => sdk.run({ synthetic: true, canaries: inputs }, ([email, phone]) => {
    sdk.observe({ type: 'DATABASE_WRITE', location: 'email', canaries: [email], metadata: storage });
    if (enabled) sdk.observe({ type: 'HTTP_OUTPUT', location: 'phone', canaries: [phone], metadata: { destination: 'phone-service', method: 'POST', path: '/' } });
  });
  const a = (await run(false)).trace; const b = (await run(true)).trace;
  assert.equal(compareTraces(a,b).addedSinks.length,1);
  assert.equal(compareTraces(a,b,{ canaryLabel: 'email' }).addedSinks.length,0);
  assert.equal(compareTraces(a,b,{ canaryLabel: 'phone' }).addedSinks.length,1);
  assert.throws(() => compareTraces(a,b,{ canaryLabel: 'missing' }));
});

test('SDK limits mark incomplete evidence; open mode still runs application operations', async () => {
  const sdk = createCanaryLineage({ serviceName: 'bounded', limits: { maxEvents: 1, maxDepth: 1 } });
  const { result, trace } = await sdk.run({ synthetic: true, canaries: inputs }, async ([email]) => {
    sdk.observe({ type: 'HTTP_INPUT', location: 'input', canaries: [email] });
    assert.equal(sdk.derive({ parents: [email], label:'derived', value:'hash', operation:'hash' }),null);
    return sdk.span('limited', [email], () => 42);
  });
  assert.equal(result,42); assert.equal(trace.events.length,1); assert.equal(trace.canaries.length,2);
  assert.equal(trace.incomplete,true); assert.equal(trace.diagnostics.length,2);
});

test('SDK guards synthetic opt-in, depth, metadata, value size and duplicate labels', async () => {
  assert.throws(() => createCanaryLineage({serviceName:'x',limits:{unknown:1}}));
  const sdk = createCanaryLineage({serviceName:'strict',failureMode:'strict',limits:{maxDepth:1,maxMetadataBytes:256,maxValueBytes:64}});
  await assert.rejects(sdk.run({canaries:inputs},()=>{}));
  await assert.rejects(sdk.run({synthetic:true,canaries:[inputs[0],inputs[0]]},()=>{}));
  await sdk.run({synthetic:true,canaries:inputs},([email])=>{
    const derived=sdk.derive({parents:[email],label:'lowercase',value:email.value,operation:'lowercase'});
    assert.throws(()=>sdk.derive({parents:[derived],label:'deep',value:'value',operation:'hash'}));
    assert.throws(()=>sdk.derive({parents:[email],label:'big',value:'x'.repeat(65),operation:'hash'}));
    assert.throws(()=>sdk.observe({type:'HTTP_OUTPUT',location:'x',canaries:[email],metadata:{body:'x'.repeat(300)}}));
  });
});

test('SDK storage errors are explicit and never replace host application errors', async () => {
  const broken={mode:'broken',async saveTrace(){throw new Error('private');},async getTrace(){return null;}};
  const open=createCanaryLineage({serviceName:'open',storage:broken});
  const result=await open.run({synthetic:true,canaries:inputs},()=>42);
  assert.equal(result.result,42);assert.equal(result.traceSaved,false);assert.equal(result.trace.incomplete,true);
  assert.ok(!JSON.stringify(result.trace).includes('private'));
  const strict=createCanaryLineage({serviceName:'strict',storage:broken,failureMode:'strict'});
  await assert.rejects(strict.run({synthetic:true,canaries:inputs},()=>42),/Trace storage failed/);
  const original=new Error('business error');
  await assert.rejects(strict.run({synthetic:true,canaries:inputs},()=>{throw original;}), e=>e===original);
});

test('PostgreSQL adapter records only returned known values, excludes SQL, and bounds inspection', async () => {
  const { postgresAdapter } = await import('../src/sdk/index.js');
  const sdk=createCanaryLineage({serviceName:'db'});
  const result=await sdk.run({synthetic:true,canaries:inputs},async([email,phone])=>{
    const pool={async query(){return {rows:[{email:email.value},{email:'unknown'}]};}};
    const db=postgresAdapter({pool,lineage:sdk,maxRows:1});
    await db.query({query:{text:'SELECT secret FROM private',values:['secret']},table:'users',column:'email',operation:'SELECT',canaries:[email,phone]});
  });
  assert.equal(result.trace.incomplete,true);
  assert.equal(result.trace.events[0].type,'DATABASE_READ');
  assert.deepEqual(result.trace.events[0].canaryIds,[result.trace.canaries[0].id]);
  assert.ok(!JSON.stringify(result.trace).includes('secret'));
});
