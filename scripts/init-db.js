import { createPool, initializeDatabase } from '../src/database.js';

let pool;
try {
  pool = createPool(process.env.DATABASE_URL);
  await initializeDatabase(pool);
  console.log('users ve lineage_traces tabloları hazır. Şimdi npm start çalıştır.');
} catch {
  console.error('Tablolar hazırlanamadı. .env, DATABASE_URL, veritabanı ve PostgreSQL servisini kontrol et.');
  process.exitCode = 1;
} finally {
  await pool?.end();
}
