import { randomUUID } from 'node:crypto';
import { currentTrace, observeWrite, observe } from '../instrumentation.js';
import { storageError } from '../errors.js';

export function postgresRepository(pool) {
  return {
    mode: 'postgres',
    async health() {
      await pool.query('SELECT id FROM users LIMIT 0');
      await pool.query('SELECT id FROM lineage_traces LIMIT 0');
    },
    async saveUser(email) {
      const trace = currentTrace();
      let client;
      let discard;
      let commitAttempted = false;
      const event = observeWrite('postgres', email);
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        const { rows: [user] } = await client.query(
          'INSERT INTO users (id, email) VALUES ($1, $2) RETURNING id, email, created_at',
          [randomUUID(), email],
        );
        // Observe the actual returned column, not just the intended SQL input.
        if (user.email !== trace.canary) throw new Error('Returned canary does not match.');
        const pending = structuredClone(trace);
        await client.query(
          'INSERT INTO lineage_traces (id, user_id, canary, document) VALUES ($1, $2, $3, $4::jsonb)',
          [pending.id, user.id, email, JSON.stringify(pending)],
        );
        // Only return success once BOTH the user and its trace have committed.
        commitAttempted = true;
        await client.query('COMMIT');
        event.status = 'success';
        event.metadata.commit = 'confirmed';
        return { user };
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(error => { discard = error; });
        event.status = commitAttempted || discard ? 'unconfirmed' : 'failed';
        observe({ stage: 'error', location: 'PostgreSQL transaction', value: email,
          metadata: { operation: 'DATABASE_WRITE', outcome: commitAttempted || discard ? 'unconfirmed' : 'not-committed' } });
        throw storageError(error);
      } finally {
        client?.release(discard);
      }
    },
    async finishTrace(trace) {
      try {
        const result = await pool.query('UPDATE lineage_traces SET document = $2::jsonb WHERE id = $1', [trace.id, JSON.stringify(trace)]);
        return result.rowCount === 1;
      } catch (error) { throw storageError(error); }
    },
    async getTrace(id) {
      try {
        const { rows } = await pool.query('SELECT document FROM lineage_traces WHERE id = $1', [id]);
        return rows[0]?.document ?? null;
      } catch (error) {
        throw storageError(error);
      }
    },
  };
}
