import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresRepository } from '../src/repositories/postgres.js';
import { startTrace } from '../src/tracker.js';
import { runWithTrace } from '../src/instrumentation.js';
import { canary } from './helpers.js';

function fakePool({ failAt } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (failAt && sql.startsWith(failAt)) throw new Error('test failure');
      if (sql.startsWith('INSERT INTO users')) return { rows: [{ id: 'user-id', email: values[1] }] };
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { calls, connect: async () => client };
}

test('adapter parameterizes SQL and commits both writes before returning success', async () => {
  const pool = fakePool();
  const email = canary();
  const trace = startTrace(email, 'postgres');
  const result = await runWithTrace(trace, () => postgresRepository(pool).saveUser(email));
  assert.equal(result.user.email, email);
  assert.equal(trace.status, 'pending');
  assert.equal(trace.events.at(-1).location, 'PostgreSQL: users.email');
  assert.equal(trace.events.at(-1).status, 'success');
  assert.deepEqual(pool.calls.map(c => c.sql.split(' ')[0]), ['BEGIN', 'INSERT', 'INSERT', 'COMMIT', 'RELEASE']);
  assert.ok(pool.calls.every(c => !c.sql.includes(email)));
  assert.equal(pool.calls[1].values[1], email);
  assert.equal(JSON.parse(pool.calls[2].values[3]).canary, email);
  assert.equal(JSON.parse(pool.calls[2].values[3]).status, 'pending');
});

for (const failAt of ['INSERT INTO users', 'INSERT INTO lineage_traces', 'COMMIT']) {
  test(`adapter rolls back and releases its client when ${failAt} fails`, async () => {
    const pool = fakePool({ failAt });
    const email = canary();
    await assert.rejects(runWithTrace(startTrace(email, 'postgres'), () => postgresRepository(pool).saveUser(email)), { code: 'STORAGE_UNAVAILABLE' });
    assert.deepEqual(pool.calls.slice(-2).map(c => c.sql), ['ROLLBACK', 'RELEASE']);
  });
}

test('PostgreSQL trace finalization parameterizes the full document and reports missing rows', async () => {
  const calls = [];
  const repository = postgresRepository({ async query(sql, values) {
    calls.push({ sql, values });
    return { rowCount: calls.length === 1 ? 1 : 0 };
  } });
  const trace = { ...startTrace(canary(), 'postgres'), status: 'failed' };
  assert.equal(await repository.finishTrace(trace), true);
  assert.equal(await repository.finishTrace(trace), false);
  assert.equal(calls[0].values[0], trace.id);
  assert.deepEqual(JSON.parse(calls[0].values[1]), trace);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.ok(!calls[0].sql.includes(trace.canary));
});
