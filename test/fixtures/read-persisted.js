// Used only by the real PostgreSQL integration test to prove cross-process persistence.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { startMockServer } from '../../src/http/mock-server.js';
import { createMockEmailClient } from '../../src/http/outbound.js';
import { once } from 'node:events';
import { createApp } from '../../src/app.js';
import { postgresRepository } from '../../src/repositories/postgres.js';

const schema = process.env.CANARY_TEST_SCHEMA;
if (!/^canary_test_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('Invalid test schema');
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
const writing = process.argv[2] === '--create';
const mock = writing ? await startMockServer() : null;
const server = createApp({ repository: postgresRepository(pool), sendEmail: mock ? createMockEmailClient(mock.url) : undefined }).listen(0, '127.0.0.1');
try {
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = writing
    ? await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `canary+${randomUUID()}@example.test`, scenario: 'http' }) })
    : await fetch(`${base}/api/traces/${process.argv[2]}`);
  if (!response.ok) throw new Error('Persisted trace unavailable');
  console.log(JSON.stringify(await response.json()));
} finally {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  await mock?.close();
}
