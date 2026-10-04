import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startDistributed } from '../examples/distributed-fixture.js';
import { buildGraph } from '../src/analysis/graph.js';
import { compareGraphs } from '../src/analysis/diff.js';
import { evaluatePolicies } from '../src/analysis/policy.js';
import { exportBundle,importBundle } from '../src/analysis/bundle.js';
let fixture,baseline,current;
const policy={schemaVersion:1,rules:[{id:'no-new',type:'NO_NEW_DESTINATIONS'},{id:'no-analytics',type:'DENY_DESTINATIONS',destinations:['analytics']},{id:'hash',type:'REQUIRE_TRANSFORMATION',label:'email-sha256',operation:'sha256'}]};
before(async()=>{fixture=await startDistributed();baseline=await fixture.run({suffix:'baseline'});current=await fixture.run({regression:true,suffix:'current'});});
after(async()=>{await fixture?.close();});

test('graph joins real causal parents across segments and shows transformation ancestry without values',()=>{
  const graph=buildGraph(current);assert.equal(graph.complete,true);
  assert.deepEqual(graph.services,['gateway','processor','users']);
  assert.ok(graph.edges.some(e=>e.type==='DERIVED_FROM'));assert.ok(graph.edges.some(e=>e.type==='SENT_TO'));
  const sink=graph.facts.find(f=>f.destination?.name==='analytics'&&f.label==='email-sha256');
  assert.deepEqual([...new Set(sink.path.map(p=>p.service))],['gateway','users','processor']);
  assert.deepEqual(sink.transformations,['lowercase','sha256']);
  assert.ok(!JSON.stringify(graph).includes('canary-current@example.test'));
});

test('semantic diff detects a real new destination/path/hop and ignores identity, ordering and timing noise',()=>{
  const diff=compareGraphs(baseline,current);const categories=new Set(diff.changes.map(c=>c.type));
  for(const type of ['NEW_DESTINATION','NEW_PATH','NEW_HTTP_HOP','CANARY_DESTINATION_CHANGED'])assert.ok(categories.has(type));
  assert.ok(diff.changes.some(c=>c.type==='NEW_DESTINATION'&&c.evidence.name==='analytics'));
  const copy=structuredClone(baseline);const ids=new Map();const remap=id=>{if(!ids.has(id))ids.set(id,randomUUID());return ids.get(id);};
  const traceId=randomUUID();
  for(const s of copy){
    s.id=traceId;s.segmentId=remap(s.segmentId);s.startedAt='later';s.finishedAt='later';
    for(const c of s.canaries){c.id=remap(c.id);c.parentCanaryIds=c.parentCanaryIds.map(remap);}
    for(const e of s.events){e.id=remap(e.id);e.traceId=traceId;e.segmentId=s.segmentId;e.parentId=e.parentId?remap(e.parentId):null;e.canaryIds=e.canaryIds.map(remap);e.occurredAt='later';e.metadata.durationMs=999;e.sequence=999;}
    s.events.reverse();
  }
  copy.reverse();assert.deepEqual(compareGraphs(baseline,copy).changes,[]);
  copy.flatMap(s=>s.events).filter(e=>e.type==='HTTP_OUTPUT').forEach(e=>e.status='failed');
  assert.deepEqual(compareGraphs(baseline,copy).changes,[]);
  assert.ok(compareGraphs(baseline,copy,{includeStatus:true}).changes.length>0);
});

test('semantic changes identify service/path/transform and DB access changes without event-ID matching',()=>{
  const copy=structuredClone(baseline);const users=copy.find(s=>s.serviceName==='users');users.serviceName='users-v2';
  for(const s of copy)for(const c of s.canaries)if(c.operation==='sha256')c.operation='redact';
  const e=structuredClone(users.events.at(-1));e.id=randomUUID();e.type='DATABASE_READ';e.location='db';e.parentId=users.events[0].id;e.metadata={table:'users',column:'email',operation:'SELECT'};users.events.push(e);
  const types=new Set(compareGraphs(baseline,copy).changes.map(c=>c.type));
  for(const type of ['NEW_SERVICE','REMOVED_SERVICE','PATH_CHANGED','TRANSFORMATION_ADDED','TRANSFORMATION_REMOVED','TRANSFORMATION_CHANGED','DB_ACCESS_CHANGED'])assert.ok(types.has(type),type);
});

test('policy demonstrates PASS/FAIL, transformation requirement, canary evidence and hop bounds',()=>{
  assert.equal(evaluatePolicies(baseline,policy,{baseline}).status,'PASS');
  const result=evaluatePolicies(current,policy,{baseline});assert.equal(result.status,'FAIL');
  const denied=result.results.find(r=>r.ruleId==='no-analytics');assert.equal(denied.evidence[0].destination.name,'analytics');assert.ok(denied.evidence[0].canaryId);
  assert.equal(result.results.find(r=>r.ruleId==='hash').status,'PASS');
  const strict={schemaVersion:1,rules:[{id:'hops',type:'MAX_SERVICE_HOPS',max:0},{id:'transform',type:'REQUIRE_TRANSFORMATION',operation:'encrypt',label:'email-sha256',severity:'warn'},{id:'customer',type:'DENY_CANARY_DESTINATIONS',label:'customer',destinations:['analytics']}]};
  const checks=evaluatePolicies(current,strict);assert.equal(checks.results[0].status,'FAIL');assert.equal(checks.results[1].status,'WARN');assert.equal(checks.results[2].status,'FAIL');
  assert.throws(()=>evaluatePolicies(current,{schemaVersion:1,rules:[{id:'x',type:'NO_NEW_DESTINATIONS',label:'ignored'}]},{baseline}));
  assert.throws(()=>evaluatePolicies(current,policy));
});

test('missing/truncated segments cannot create a passing policy verdict; cycles and duplicate IDs are rejected',()=>{
  const missing=baseline.filter(s=>s.serviceName!=='processor');assert.equal(buildGraph(missing).complete,false);
  assert.equal(evaluatePolicies(missing,{schemaVersion:1,rules:[]}).status,'FAIL');
  const incomplete=structuredClone(baseline);incomplete[0].incomplete=true;assert.equal(buildGraph(incomplete).complete,false);
  const bad=structuredClone(baseline);bad[0].events[0].parentId=bad[0].events[0].id;assert.throws(()=>buildGraph(bad));
  assert.throws(()=>buildGraph([...baseline,baseline[0]]));
  assert.throws(()=>buildGraph({schemaVersion:99}));
});

test('portable bundles round-trip value-free graph evidence and detect corruption',()=>{
  const bundle=exportBundle(current);const text=JSON.stringify(bundle);
  assert.ok(!text.includes('canary-current@example.test'));assert.ok(!text.includes('synthetic-current'));
  assert.deepEqual(buildGraph(importBundle(JSON.parse(text))),buildGraph(current));
  bundle.segments[0].serviceName='tampered';assert.throws(()=>importBundle(bundle),/checksum/);
});

test('CLI reproduces CI pass/fail, stable JSON, verify/export, invalid input and usage exit codes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'canary-cli-'));
  try{
    for(const [file,data] of Object.entries({'a.json':exportBundle(baseline),'b.json':exportBundle(current),'policy.json':policy}))await writeFile(join(dir,file),JSON.stringify(data));
    const run=(...args)=>spawnSync(process.execPath,['src/cli.js',...args],{encoding:'utf8',timeout:10000});
    const a=join(dir,'a.json'),b=join(dir,'b.json'),p=join(dir,'policy.json');
    const pass=run('compare',a,a,'--policy',p,'--json');assert.equal(pass.status,0,pass.stderr);assert.equal(JSON.parse(pass.stdout).policy.status,'PASS');
    const fail=run('compare',a,b,'--policy',p,'--json');assert.equal(fail.status,1,fail.stderr);assert.equal(JSON.parse(fail.stdout).policy.status,'FAIL');
    const human=run('compare',a,b,'--policy',p);assert.match(human.stdout,/NEW_DESTINATION/);assert.match(human.stdout,/analytics/);
    assert.equal(run('verify',a,'--json').status,0);assert.equal(run('inspect',a).status,0);
    const exported=run('export',a);assert.equal(exported.status,0);assert.equal(importBundle(JSON.parse(exported.stdout)).length,3);
    assert.equal(run('unknown',a).status,2);assert.equal(run('compare',a,b,'--policy',join(dir,'absent')).status,2);
    await writeFile(join(dir,'bad.json'),'{broken secret');const invalid=run('inspect',join(dir,'bad.json'),'--json');assert.equal(invalid.status,3);assert.ok(!invalid.stderr.includes('secret'));
    await writeFile(join(dir,'huge.json'),'x'.repeat(2*1024*1024+1));assert.equal(run('inspect',join(dir,'huge.json')).status,3);
  }finally{await rm(dir,{recursive:true,force:true});}
});
