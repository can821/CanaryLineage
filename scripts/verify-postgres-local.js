// Run in a normal local terminal. No installation, global config or memory fallback.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
const rawExec = promisify(execFile);
const interrupt = new AbortController();
const stop = () => interrupt.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const exec = (file, args, options) => rawExec(file, args, { ...options, signal: interrupt.signal });
let temporary;
let started = false;
let pgCtl;
let stage = 'configuration';
let exitCode = 0;
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--temporary') || args.length > 1) throw new Error('arguments');
  let connectionString = process.env.TEST_DATABASE_URL;
  if (args.includes('--temporary')) {
    stage = 'PostgreSQL binaries: set PG_BIN to the existing bin directory';
    const bin = process.env.PG_BIN;
    if (!bin) throw new Error('PG_BIN');
    const initdb = join(bin, 'initdb'); pgCtl = join(bin, 'pg_ctl');
    await Promise.all([access(initdb), access(pgCtl)]);
    await exec(initdb, ['--version'], { timeout: 5000 });
    temporary = await mkdtemp(join(tmpdir(), 'canary-pg-'));
    const password = randomBytes(24).toString('hex');
    const passwordFile = join(temporary, 'password');
    await writeFile(passwordFile, password, { mode: 0o600 });
    stage = 'temporary PostgreSQL initialization (OS shared-memory permissions may block it)';
    await exec(initdb, ['-D', join(temporary, 'data'), '-U', 'canary_verify', '--auth=scram-sha-256', '--pwfile', passwordFile, '--no-locale', '-E', 'UTF8'], { timeout: 30000 });
    // Reserve an available loopback port briefly; a race fails safely at startup.
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    // Use configuration file quoting, not a shell-interpolated command string.
    await writeFile(join(temporary, 'data', 'postgresql.auto.conf'), `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\n`);
    stage = 'temporary PostgreSQL startup';
    // Set before startup so cleanup also handles a startup timeout.
    started = true;
    await exec(pgCtl, ['-D', join(temporary, 'data'), '-l', join(temporary, 'server.log'), '-w', '-t', '15', 'start'], { timeout: 20000 });
    connectionString = `postgresql://canary_verify:${password}@127.0.0.1:${port}/postgres`;
  }
  stage = 'TEST_DATABASE_URL: set a dedicated LOCAL test database URL in .env';
  if (!connectionString) throw new Error('missing');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.search || /YOUR_(USER|PASSWORD)/.test(connectionString)) throw new Error('invalid');
  stage = 'dependencies: run npm ci first';
  const { default: pg } = await import('pg');
  stage = 'connection: check the PostgreSQL service, database and credentials';
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  pool.on('error', () => {});
  try { await pool.query('SELECT 1'); } finally { await pool.end(); }
  console.log('PASS: real PostgreSQL connection.');
  stage = 'integration: schema, INSERT, HTTP, rollback and application-process restart';
  const testFiles = (await readdir(new URL('../test/integration/', import.meta.url))).filter(name => name.endsWith('.test.js')).sort().map(name => `test/integration/${name}`);
  const { stdout } = await exec(process.execPath, ['--test', ...testFiles], {
    cwd: new URL('..', import.meta.url), timeout: 60000,
    env: { ...process.env, TEST_DATABASE_URL: connectionString }, maxBuffer: 1024 * 1024,
  });
  // Test output can include raw driver errors on failure; never print it or credentials.
  if (!stdout) throw new Error('missing test output');
  console.log('PASS: real schema + INSERT + trace retrieval + HTTP + transactions + writer process exit + fresh reader process.');
} catch {
  exitCode = 1;
  console.error(`FAIL: ${stage}. No PostgreSQL verification claimed. See docs/POSTGRES_LOCAL.md.`);
} finally {
  if (temporary) {
    let safeToRemove = !started;
    if (started) {
      try { await rawExec(pgCtl, ['-D', join(temporary, 'data'), '-m', 'fast', '-w', '-t', '15', 'stop'], { timeout: 20000 }); safeToRemove = true; }
      catch {
        // Exit 3 from pg_ctl status means definitely not running; all other outcomes preserve data.
        try { await rawExec(pgCtl, ['-D', join(temporary, 'data'), 'status'], { timeout: 5000 }); }
        catch (error) { safeToRemove = error.code === 3; }
        if (!safeToRemove) { exitCode = 1; console.error(`FAIL: cleanup; inspect temporary cluster at ${temporary}.`); }
      }
    }
    if (safeToRemove) await rm(temporary, { recursive: true, force: true });
  }
}
process.exitCode = exitCode;
