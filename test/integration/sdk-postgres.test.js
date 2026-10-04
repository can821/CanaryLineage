import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import pg from 'pg';
import { createCanaryLineage, postgresAdapter, postgresTraceStore } from '../../src/sdk/index.js';

test('real PostgreSQL SDK: explicit hash -> write -> read -> real HTTP and durable trace', async t => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL required');
  const schema = `sdk_test_${randomUUID().replaceAll('-','')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis:3000 });
  let pool;
  t.after(async()=>{ await pool?.end(); try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); } });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString:process.env.TEST_DATABASE_URL, options:`-c search_path=${schema}`, connectionTimeoutMillis:3000 });
  await pool.query('CREATE TABLE sdk_values (value TEXT NOT NULL)');
  const store=postgresTraceStore(pool); await store.initialize();
  const sdk=createCanaryLineage({serviceName:'sdk-integration',storage:store,failureMode:'strict'});
  const db=postgresAdapter({pool,lineage:sdk});
  let received='';
  const server=createServer(async(req,res)=>{ for await (const part of req) received+=part; res.writeHead(204).end(); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await sdk.run({synthetic:true,canaries:[{label:'email',value:'canary-sdk@example.test'},{label:'customer',value:'synthetic-customer-1'}]},async([email])=>{
    const hashed=sdk.derive({parents:[email],label:'email-sha256',value:createHash('sha256').update(email.value).digest('hex'),operation:'sha256'});
    await db.query({query:{text:'INSERT INTO sdk_values (value) VALUES ($1) RETURNING value',values:[hashed.value]},canaries:[hashed],table:'sdk_values',column:'value',operation:'INSERT'});
    const rows=await db.query({query:{text:'SELECT value FROM sdk_values'},canaries:[hashed],table:'sdk_values',column:'value',operation:'SELECT'});
    const response=await fetch(`http://127.0.0.1:${server.address().port}/sink`,{method:'POST',body:rows.rows[0].value});
    assert.equal(response.status,204);
    sdk.observe({type:'HTTP_OUTPUT',location:'local-test-sink',canaries:[hashed],status:'success',metadata:{destination:'local-test-sink',method:'POST',path:'/sink'}});
    return hashed.value;
  });
  assert.equal(received,result.result);
  assert.deepEqual(result.trace.events.map(e=>e.type),['TRANSFORMATION','DATABASE_WRITE','DATABASE_READ','HTTP_OUTPUT']);
  assert.ok(result.trace.events.every(e=>e.canaryIds[0]===result.trace.canaries[2].id));
  assert.equal(result.traceSaved,true);
  const reader=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  try { assert.deepEqual(await postgresTraceStore(reader).getTrace(result.trace.id),result.trace); } finally { await reader.end(); }
});
