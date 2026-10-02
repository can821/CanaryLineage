import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startMockServer } from '../../src/http/mock-server.js';
import { createMockEmailClient } from '../../src/http/outbound.js';
import { initializeDatabase } from '../../src/database.js';
import { postgresRepository } from '../../src/repositories/postgres.js';
import { canary, serve, submission } from '../helpers.js';

// Deliberately fail if explicitly invoked without a real database, never "pass" by skipping.
test('real PostgreSQL: persistence, duplicate protection, concurrent traces and rollback', async t => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a dedicated local test database.');
  const schema = `canary_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 3000 });
  let pool;
  t.after(async () => {
    await pool?.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const makePool = () => new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
  pool = makePool();
  await initializeDatabase(pool);
  await initializeDatabase(pool); // Re-running initialization must preserve data/schema.
  const mock = await startMockServer();
  t.after(() => mock.close());
  const http = await serve(t, postgresRepository(pool), { sendEmail: createMockEmailClient(mock.url) });
  const input = { ...submission(), scenario: 'http' };
  const response = await http.post(input);
  assert.equal(response.status, 201);
  const { user, trace } = await response.json();
  assert.deepEqual(trace.events.map(e => e.stage), ['browser', 'http', 'function', 'database', 'http-output']);
  assert.equal(trace.events[3].status, 'success');
  assert.equal(trace.events[4].parentId, trace.events[3].parentId);
  const stored = await pool.query('SELECT email FROM users WHERE id = $1', [user.id]);
  assert.equal(stored.rows[0].email, input.email);
  assert.equal((await http.post(input)).status, 409);
  assert.equal((await pool.query('SELECT count(*) FROM lineage_traces')).rows[0].count, '1');

  // A fresh connection/repository reads durable data, not a process-local trace map.
  const reader = makePool();
  try { assert.deepEqual(await postgresRepository(reader).getTrace(trace.id), trace); }
  finally { await reader.end(); }

  // Start a fresh Node application process; only PostgreSQL can supply this trace.
  const { stdout } = await promisify(execFile)(process.execPath,
    [new URL('../fixtures/read-persisted.js', import.meta.url).pathname, trace.id],
    { env: { ...process.env, CANARY_TEST_SCHEMA: schema }, timeout: 10000 });
  assert.deepEqual(JSON.parse(stdout).trace, trace);

  // The writer application exits completely before a new reader application starts.
  const childOptions = { env: { ...process.env, CANARY_TEST_SCHEMA: schema }, timeout: 10000 };
  const fixture = new URL('../fixtures/read-persisted.js', import.meta.url).pathname;
  const written = await promisify(execFile)(process.execPath, [fixture, '--create'], childOptions);
  const writtenTrace = JSON.parse(written.stdout).trace;
  assert.equal(writtenTrace.storage, 'postgres');
  assert.equal(writtenTrace.events.find(e => e.type === 'DATABASE_WRITE').status, 'success');
  assert.equal(writtenTrace.events.find(e => e.type === 'HTTP_OUTPUT').status, 'success');
  const restarted = await promisify(execFile)(process.execPath, [fixture, writtenTrace.id], childOptions);
  assert.deepEqual(JSON.parse(restarted.stdout).trace, writtenTrace);

  const failedHttp = await http.post({ ...submission(), scenario: 'http-failure' });
  assert.equal(failedHttp.status, 502);
  const failedBody = await failedHttp.json();
  assert.equal(failedBody.trace.events.find(e => e.type === 'DATABASE_WRITE').status, 'success');
  assert.deepEqual(await postgresRepository(pool).getTrace(failedBody.trace.id), failedBody.trace);

  const inputs = Array.from({ length: 8 }, () => submission());
  const traces = await Promise.all(inputs.map(async value => {
    const res = await http.post(value);
    assert.equal(res.status, 201);
    return (await res.json()).trace;
  }));
  assert.equal(new Set(traces.map(value => value.id)).size, inputs.length);
  traces.forEach((value, i) => assert.ok(value.events.every(e => e.value === inputs[i].email)));
  const repeated = submission();
  const race = await Promise.all([http.post(repeated), http.post(repeated)]);
  assert.deepEqual(race.map(res => res.status).sort(), [201, 409]);

  // Force the SECOND insert to fail in our disposable schema, then check rollback.
  await pool.query(`ALTER TABLE lineage_traces ADD CONSTRAINT force_failure CHECK (canary = 'never') NOT VALID`);
  const failedEmail = canary();
  const failed = await http.post(submission(failedEmail));
  assert.equal(failed.status, 503);
  assert.equal((await pool.query('SELECT count(*) FROM users WHERE email = $1', [failedEmail])).rows[0].count, '0');
  assert.equal((await pool.query('SELECT count(*) FROM lineage_traces WHERE canary = $1', [failedEmail])).rows[0].count, '0');
});
