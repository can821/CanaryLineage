import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startTrace } from '../src/tracker.js';
import { currentTrace, runWithTrace, observe, tracedFunction } from '../src/instrumentation.js';
import { memoryRepository } from '../src/repositories/memory.js';
import { postgresRepository } from '../src/repositories/postgres.js';
import { canary, serve, submission } from './helpers.js';

test('overlapping HTTP requests retain context across timer and Promise boundaries', async t => {
  const repository = memoryRepository();
  const observed = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let arrivals = 0;
  const http = await serve(t, { ...repository, async saveUser(email) {
    const before = currentTrace();
    if (++arrivals === 12) release();
    await barrier; // All twelve requests must overlap, rather than merely run in a loop.
    await delay(Math.random() * 5);
    await Promise.resolve();
    assert.equal(currentTrace(), before);
    assert.equal(currentTrace().canary, email);
    observed.push(before.id);
    return repository.saveUser(email);
  } });
  const inputs = Array.from({ length: 12 }, () => submission());
  const results = await Promise.all(inputs.map(async body => {
    const response = await http.post(body, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 201);
    return response.json();
  }));
  assert.equal(new Set(observed).size, 12);
  results.forEach(({ trace }, index) => {
    assert.ok(trace.events.every(event => event.value === inputs[index].email));
    assert.equal(trace.events[2].parentId, trace.events[1].id);
    assert.equal(trace.events[3].parentId, trace.events[2].id);
  });
  assert.throws(currentTrace, /context is missing/);
});

test('sibling async services inherit their own parent, not the last active sibling', async () => {
  const trace = startTrace(canary(), 'test');
  const service = tracedFunction('work', value => value, async value => {
    await delay(1);
    return observe({ stage: 'demo-store', location: 'test sink', value });
  });
  await runWithTrace(trace, async () => {
    const children = await Promise.all([service(trace.canary), service(trace.canary)]);
    assert.equal(children[0].parentId, trace.events[0].id);
    assert.equal(children[1].parentId, trace.events[1].id);
  });
  assert.throws(currentTrace, /context is missing/);
});

test('failed request returns a safe partial trace and never a completed DB result', async t => {
  const http = await serve(t, postgresRepository({ async connect() { throw new Error('password=secret'); } }));
  const response = await http.post(submission());
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.trace.status, 'failed');
  assert.equal(result.trace.events.find(event => event.stage === 'function').status, 'failed');
  assert.equal(result.trace.events.at(-1).type, 'ERROR');
  assert.equal(result.trace.events.at(-1).metadata.outcome, 'not-committed');
  assert.doesNotMatch(JSON.stringify(result), /password|secret/);
  assert.throws(currentTrace, /context is missing/);
});
