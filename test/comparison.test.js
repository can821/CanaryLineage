import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compareTraces } from '../src/comparison.js';
import { memoryRepository } from '../src/repositories/memory.js';
import { startMockServer } from '../src/http/mock-server.js';
import { createMockEmailClient } from '../src/http/outbound.js';
import { serve, submission } from './helpers.js';

const storage = { type: 'DEMO_WRITE', metadata: { table: 'users', column: 'email', operation: 'INSERT' }, status: 'success' };
const http = { type: 'HTTP_OUTPUT', metadata: { destination: 'mock-email-service', method: 'POST', path: '/mock-email' }, status: 'success' };
const trace = events => ({ id: randomUUID(), storage: 'memory-demo', status: 'completed', events: structuredClone(events) });

test('added and removed HTTP destinations retain the unchanged storage target', () => {
  const a = trace([storage]); const b = trace([storage, http]);
  const added = compareTraces(a, b); const removed = compareTraces(b, a);
  assert.equal(added.addedSinks[0].destination, 'mock-email-service');
  assert.equal(added.unchangedSinks[0].destination, 'users.email');
  assert.deepEqual(added.removedSinks, []);
  assert.deepEqual(removed.removedSinks, added.addedSinks);
  assert.deepEqual(removed.addedSinks, []);
});

test('identity ignores ordering, duplicates, IDs, values, timestamps, durations and outcome', () => {
  const a = trace([storage, http]);
  const b = trace([http, storage, http]);
  b.events.forEach(e => { e.id = randomUUID(); e.value = 'different'; e.occurredAt = 'later'; e.status = 'failed'; e.metadata.durationMs = 500; });
  const result = compareTraces(a, b);
  assert.deepEqual(result.addedSinks, []); assert.deepEqual(result.removedSinks, []);
  assert.deepEqual(result.unchangedSinks, compareTraces(a, a).unchangedSinks);
});

test('demo and PostgreSQL share logical storage identity without hiding their storage modes', () => {
  const a = trace([storage]); const b = trace([{ ...storage, type: 'DATABASE_WRITE' }]); b.storage = 'postgres';
  const result = compareTraces(a, b);
  assert.equal(result.unchangedSinks.length, 1); assert.equal(result.addedSinks.length, 0);
  assert.equal(result.baselineStorage, 'memory-demo'); assert.equal(result.currentStorage, 'postgres');
});

test('destination, method, real path and storage column changes are meaningful', () => {
  for (const metadata of [{ ...http.metadata, destination: 'other-service' }, { ...http.metadata, method: 'PUT' }, { ...http.metadata, path: '/other' }]) {
    const result = compareTraces(trace([http]), trace([{ ...http, metadata }]));
    assert.equal(result.addedSinks.length, 1); assert.equal(result.removedSinks.length, 1);
  }
  assert.equal(compareTraces(trace([storage]), trace([{ ...storage, metadata: { ...storage.metadata, column: 'backup_email' } }])).addedSinks.length, 1);
});

test('legacy failure route and new logical sinkPath do not invent a new mock destination', () => {
  for (const metadata of [{ ...http.metadata, path: '/mock-email/fail' }, { ...http.metadata, path: '/mock-email/fail', sinkPath: '/mock-email' }]) {
    const result = compareTraces(trace([http]), trace([{ ...http, status: 'failed', metadata }]));
    assert.equal(result.unchangedSinks.length, 1); assert.deepEqual(result.addedSinks, []);
  }
  const empty = compareTraces(trace([{ type: 'FUNCTION' }]), trace([]));
  for (const key of ['addedSinks', 'removedSinks', 'unchangedSinks']) assert.deepEqual(empty[key], []);
});

test('comparison API compares real storage/HTTP/failure executions and preserves saved evidence', async t => {
  const mock = await startMockServer(); t.after(() => mock.close());
  const app = await serve(t, memoryRepository(), { sendEmail: createMockEmailClient(mock.url) });
  const results = [];
  for (const scenario of ['storage', 'http', 'http-failure']) {
    const response = await app.post({ ...submission(), scenario });
    assert.equal(response.status, scenario === 'http-failure' ? 502 : 201);
    results.push((await response.json()).trace);
  }
  const [a, b, failed] = results;
  const get = async (x, y) => (await app.get(`/api/compare?baseline=${x.id}&current=${y.id}`)).json();
  assert.equal((await get(a, b)).addedSinks[0].destination, 'mock-email-service');
  assert.equal((await get(b, a)).removedSinks.length, 1);
  assert.equal((await get(b, failed)).addedSinks.length, 0);
  assert.equal((await get(b, b)).unchangedSinks.length, 2);
  const equivalent = (await (await app.post(submission())).json()).trace;
  const same = await get(a, equivalent);
  assert.deepEqual(same.addedSinks, []); assert.deepEqual(same.removedSinks, []);
  assert.equal(same.unchangedSinks.length, 1);
  assert.equal(failed.events.find(e => e.type === 'DEMO_WRITE').status, 'success');
  assert.deepEqual((await (await app.get(`/api/traces/${b.id}`)).json()).trace, b);
});

test('comparison API distinguishes malformed, missing traces and unavailable storage', async t => {
  const app = await serve(t, memoryRepository());
  for (const query of ['', '?baseline=no&current=no', `?baseline=${randomUUID()}`, `?baseline=${randomUUID()}&baseline=${randomUUID()}&current=${randomUUID()}`]) {
    assert.equal((await app.get(`/api/compare${query}`)).status, 400);
  }
  assert.equal((await app.get(`/api/compare?baseline=${randomUUID()}&current=${randomUUID()}`)).status, 404);
  const broken = await serve(t, { mode: 'postgres', async getTrace() { throw new Error('secret'); } });
  const response = await broken.get(`/api/compare?baseline=${randomUUID()}&current=${randomUUID()}`);
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('secret'));
});
