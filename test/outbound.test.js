import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { memoryRepository } from '../src/repositories/memory.js';
import { createMockEmailClient } from '../src/http/outbound.js';
import { startMockServer } from '../src/http/mock-server.js';
import { currentTrace } from '../src/instrumentation.js';
import { serve, submission } from './helpers.js';

async function setup(t, repository = memoryRepository()) {
  const mock = await startMockServer();
  t.after(() => mock.close());
  const http = await serve(t, repository, { sendEmail: createMockEmailClient(mock.url) });
  return { http, mock };
}

test('actual loopback HTTP produces sibling storage/output events and retrievable final trace', async t => {
  const { http } = await setup(t);
  const response = await http.post({ ...submission(), scenario: 'http' });
  assert.equal(response.status, 201);
  const { trace, readable, traceSaved } = await response.json();
  assert.equal(traceSaved, true);
  const service = trace.events.find(e => e.type === 'FUNCTION');
  const storage = trace.events.find(e => e.type === 'DEMO_WRITE');
  const output = trace.events.find(e => e.type === 'HTTP_OUTPUT');
  assert.equal(storage.parentId, service.id);
  assert.equal(output.parentId, service.id);
  assert.equal(output.status, 'success');
  assert.equal(output.metadata.httpStatus, 204);
  assert.equal(output.value, trace.canary);
  assert.match(readable, /├─ Memory/);
  assert.match(readable, /└─ POST mock-email-service/);
  assert.deepEqual((await (await http.get(`/api/traces/${trace.id}`)).json()).trace, trace);
});

test('HTTP failure preserves successful storage and saves a retrievable failed trace', async t => {
  const { http } = await setup(t);
  const input = { ...submission(), scenario: 'http-failure' };
  const response = await http.post(input);
  assert.equal(response.status, 502);
  const { trace, traceSaved } = await response.json();
  assert.equal(traceSaved, true);
  assert.equal(trace.status, 'failed');
  assert.equal(trace.events.find(e => e.type === 'DEMO_WRITE').status, 'success');
  assert.equal(trace.events.find(e => e.type === 'HTTP_OUTPUT').metadata.httpStatus, 503);
  assert.equal(trace.events.find(e => e.type === 'HTTP_OUTPUT').status, 'failed');
  assert.deepEqual((await (await http.get(`/api/traces/${trace.id}`)).json()).trace, trace);
  assert.equal((await http.post(input)).status, 409); // Earlier storage was not rolled back.
});

test('overlapping successful and failed outgoing requests retain isolated branch relationships', async t => {
  const memory = memoryRepository();
  let arrivals = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const { http } = await setup(t, { ...memory, async saveUser(email) {
    if (++arrivals === 8) release();
    await barrier;
    return memory.saveUser(email);
  } });
  const results = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const input = { ...submission(), scenario: i % 2 ? 'http-failure' : 'http' };
    const res = await http.post(input, { signal: AbortSignal.timeout(5000) });
    const { trace } = await res.json();
    assert.equal(res.status, i % 2 ? 502 : 201);
    assert.ok(trace.events.every(e => e.value === input.email));
    const service = trace.events.find(e => e.type === 'FUNCTION');
    assert.equal(trace.events.find(e => e.type === 'HTTP_OUTPUT').parentId, service.id);
    return trace.id;
  }));
  assert.equal(new Set(results).size, 8);
  assert.throws(currentTrace, /context is missing/);
});

test('timeout is bounded and trace metadata never copies response or request secrets', async t => {
  const server = createServer((_req, _res) => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const http = await serve(t, memoryRepository(), {
    sendEmail: createMockEmailClient(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 30 }),
  });
  const response = await http.post({ ...submission(), scenario: 'http', password: 'do-not-log-this' });
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.trace.events.at(-1).metadata.failure, 'timeout');
  assert.doesNotMatch(JSON.stringify(result), /do-not-log-this|password|authorization/);
});

test('trace-store finalization failure is not reported as successful signup', async t => {
  const memory = memoryRepository();
  const { http } = await setup(t, { ...memory, async finishTrace() { throw new Error('secret connection'); } });
  const response = await http.post({ ...submission(), scenario: 'http' });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.traceSaved, false);
  assert.equal(result.trace.status, 'failed');
  assert.equal(result.trace.events.find(e => e.type === 'DEMO_WRITE').status, 'success');
  assert.equal(result.trace.events.find(e => e.type === 'HTTP_OUTPUT').status, 'success');
  assert.equal(result.trace.events.at(-1).location, 'Trace store');
  assert.doesNotMatch(JSON.stringify(result), /secret connection/);
  assert.equal((await memory.getTrace(result.trace.id)).status, 'pending');
});

test('outbound URL cannot be user-controlled, credentialed or off-loopback; bad scenario writes nothing', async t => {
  for (const url of ['https://example.com', 'http://localhost:3000', 'http://user:secret@127.0.0.1:3000', 'http://127.0.0.1:3000/?secret=yes']) {
    assert.throws(() => createMockEmailClient(url), /127.0.0.1/);
  }
  const { http } = await setup(t);
  assert.equal((await http.post({ ...submission(), scenario: 'arbitrary-url' })).status, 400);
});
