import test from 'node:test';
import assert from 'node:assert/strict';
import { startTrace, record, completeTrace } from '../src/tracker.js';
import { canary } from './helpers.js';

test('tracker rejects changed values instead of claiming a continuous flow', () => {
  const trace = startTrace(canary(), 'test');
  assert.throws(() => record(trace, { stage: 'function', location: 'createUser()', value: canary() }), /Canary changed/);
  assert.equal(trace.events.length, 0);
});

test('completed trace is a detached snapshot and refuses later observations', () => {
  const trace = startTrace(canary(), 'test');
  record(trace, { stage: 'http', location: 'POST /api/signup', value: trace.canary });
  const snapshot = completeTrace(trace);
  trace.events[0].location = 'changed';
  assert.equal(snapshot.events[0].location, 'POST /api/signup');
  assert.throws(() => record(snapshot, { value: snapshot.canary }), /completed trace/);
});
