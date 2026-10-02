import pg from 'pg';
import { readFile } from 'node:fs/promises';

export function createPool(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is missing. Configure .env or use npm run demo.');
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
  // Never print a connection string or database error detail (it may contain data).
  pool.on('error', () => console.error('PostgreSQL connection lost; the next request will attempt to reconnect.'));
  return pool;
}

export async function initializeDatabase(pool) {
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
