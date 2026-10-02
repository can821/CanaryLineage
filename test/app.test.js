import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryRepository } from '../src/repositories/memory.js';
import { postgresRepository } from '../src/repositories/postgres.js';
import { canary, serve, submission } from './helpers.js';

test('form request records four correlated steps and can be read back', async t => {
  const http = await serve(t, memoryRepository());
  const input = submission();
  const response = await http.post(input);
  assert.equal(response.status, 201);
  const { user, trace, readable } = await response.json();
  assert.equal(user.email, input.email);
  assert.equal(trace.status, 'completed');
  assert.equal(trace.storage, 'memory-demo');
  assert.deepEqual(trace.events.map(e => e.stage), ['browser', 'http', 'function', 'demo-store']);
  assert.deepEqual(trace.events.map(e => e.sequence), [1, 2, 3, 4]);
  assert.ok(trace.events.every(e => e.value === input.email));
  assert.equal(trace.events[0].evidence, 'client-reported');
  assert.equal(trace.events[3].evidence, 'demo-only');
  assert.match(readable, /createUser\(\)/);
  assert.deepEqual((await (await http.get(`/api/traces/${trace.id}`)).json()).trace, trace);
});

test('API-only request does not invent a Browser observation', async t => {
  const http = await serve(t, memoryRepository());
  const { trace } = await (await http.post({ email: canary() })).json();
  assert.deepEqual(trace.events.map(e => e.stage), ['http', 'function', 'demo-store']);
});

test('concurrent requests keep their trace IDs and values separate', async t => {
  const http = await serve(t, memoryRepository());
  const inputs = Array.from({ length: 16 }, () => submission());
  const traces = await Promise.all(inputs.map(async input => (await (await http.post(input)).json()).trace));
  assert.equal(new Set(traces.map(trace => trace.id)).size, 16);
  traces.forEach((trace, i) => assert.ok(trace.events.every(event => event.value === inputs[i].email)));
});

test('duplicate canary returns 409 and original trace remains unchanged', async t => {
  const http = await serve(t, memoryRepository());
  const input = submission();
  const { trace } = await (await http.post(input)).json();
  const duplicate = await http.post(input);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'CANARY_EXISTS');
  assert.deepEqual((await (await http.get(`/api/traces/${trace.id}`)).json()).trace, trace);
});

test('invalid input never reaches the repository', async t => {
  let writes = 0;
  const http = await serve(t, { mode: 'test', saveUser() { writes++; } });
  for (const body of [null, {}, [], { email: 'person@gmail.com' }, { email: 42 }, { email: "'; DROP TABLE users;--" }, { ...submission(), browserEvent: { value: canary(), occurredAt: 'yesterday' } }]) {
    assert.equal((await http.post(body)).status, 400);
  }
  assert.equal(writes, 0);
});

test('bad JSON, oversized body and non-JSON requests produce safe errors', async t => {
  const http = await serve(t, memoryRepository());
  assert.equal((await http.post({}, { body: '{bad' })).status, 400);
  assert.equal((await http.post({ junk: 'x'.repeat(9000) })).status, 413);
  assert.equal((await http.post({}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('missing trace and malformed ID have distinct responses', async t => {
  const http = await serve(t, memoryRepository());
  assert.equal((await http.get('/api/traces/bad')).status, 400);
  assert.equal((await http.get('/api/traces/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await http.get('/unknown')).status, 404);
});

test('unavailable PostgreSQL never silently falls back or exposes raw errors', async t => {
  const fail = async () => { throw new Error('postgresql://secret:password@host/db'); };
  const http = await serve(t, postgresRepository({ connect: fail, query: fail }));
  const health = await http.get('/api/health');
  assert.equal(health.status, 503);
  assert.equal((await health.json()).storage, 'postgres');
  const response = await http.post(submission());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /secret|password|completed/);
  assert.match(text, /STORAGE_UNAVAILABLE/);
});

test('demo has an explicit bounded capacity', async t => {
  const http = await serve(t, memoryRepository({ limit: 1 }));
  assert.equal((await http.post(submission())).status, 201);
  const response = await http.post(submission());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DEMO_FULL');
});

test('static form and health endpoint are served with security headers', async t => {
  const http = await serve(t, memoryRepository());
  const page = await http.get('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /CanaryLineage/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-powered-by'), null);
  assert.deepEqual(await (await http.get('/api/health')).json(), { status: 'ready', storage: 'memory-demo', outbound: false });
});
