import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startDistributed } from '../../examples/distributed-fixture.js';
import { compareGraphs } from '../../src/analysis/diff.js';
import { evaluatePolicies } from '../../src/analysis/policy.js';
import { postgresTraceStore } from '../../src/sdk/index.js';

test('distributed gateway/users/processor retains PostgreSQL write/read identity and persisted segments',async t=>{
  assert.ok(process.env.TEST_DATABASE_URL,'TEST_DATABASE_URL required');
  const schema=`distributed_test_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});let pool;let fixture;
  t.after(async()=>{await fixture?.close();await pool?.end();try{await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await admin.end();}});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  await pool.query('CREATE TABLE distributed_values (value TEXT NOT NULL)');
  const store=postgresTraceStore(pool);await store.initialize();
  fixture=await startDistributed({schema,pool});
  const baseline=await fixture.run({suffix:'baseline'});
  const segments=await fixture.run({regression:true,suffix:'regression'});
  const policy={schemaVersion:1,rules:[{id:'no-new',type:'NO_NEW_DESTINATIONS'},{id:'no-analytics',type:'DENY_DESTINATIONS',destinations:['analytics']}]};
  assert.equal(evaluatePolicies(baseline,policy,{baseline}).status,'PASS');
  assert.equal(evaluatePolicies(segments,policy,{baseline}).status,'FAIL');
  assert.ok(compareGraphs(baseline,segments).changes.some(c=>c.type==='NEW_DESTINATION'&&c.evidence.name==='analytics'));
  const users=segments.find(s=>s.serviceName==='users');
  assert.deepEqual(users.events.filter(e=>e.type.startsWith('DATABASE')).map(e=>e.type),['DATABASE_WRITE','DATABASE_READ']);
  assert.equal(fixture.received.length,1);
  const stored=await store.getSegments(users.id);assert.equal(stored.length,2); // gateway + DB-owning users; processor collector is memory only.
  assert.equal((await pool.query('SELECT count(*) FROM distributed_values')).rows[0].count,'2');
  assert.deepEqual(stored.find(s=>s.segmentId===users.segmentId),users);
});
