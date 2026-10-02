import { createApp } from './app.js';
import { createPool } from './database.js';
import { memoryRepository } from './repositories/memory.js';
import { postgresRepository } from './repositories/postgres.js';
import { startMockServer } from './http/mock-server.js';
import { createMockEmailClient } from './http/outbound.js';

const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT ?? 3000);
let pool;
let mock;
try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 1–65535 arasında olmalı.');
  pool = demo ? null : createPool(process.env.DATABASE_URL);
  const repository = demo ? memoryRepository() : postgresRepository(pool);
  mock = await startMockServer();
  const server = createApp({ repository, sendEmail: createMockEmailClient(mock.url) }).listen(port, '127.0.0.1', () => {
    console.log(`CanaryLineage: http://127.0.0.1:${port} [${repository.mode}]`);
    if (demo) console.log('DEMO: PostgreSQL kullanılmıyor. Kayıtlar yeniden başlatınca silinir.');
  });
  server.on('error', async () => {
    console.error('Sunucu açılamadı. Port kullanımda olabilir. PORT değerini kontrol et.');
    await pool?.end();
    await mock?.close();
    process.exitCode = 1;
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => {
      await pool?.end();
      await mock?.close();
      clearTimeout(timeout);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error.message);
  await pool?.end();
  await mock?.close();
  process.exitCode = 1;
}
