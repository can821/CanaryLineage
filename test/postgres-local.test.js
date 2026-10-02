import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(url, args = []) {
  const env = { ...process.env, TEST_DATABASE_URL: url ?? '', PG_BIN: '' };
  return spawnSync(process.execPath, ['scripts/verify-postgres-local.js', ...args], { env, encoding: 'utf8', timeout: 10000 });
}
test('local PostgreSQL workflow rejects missing configuration without claiming verification', () => {
  const result = run();
  assert.equal(result.status, 1); assert.match(result.stderr, /FAIL: TEST_DATABASE_URL/);
  assert.doesNotMatch(result.stdout, /PASS/);
});
test('local verification refuses remote URLs and never prints credentials', () => {
  const result = run('postgresql://private-user:super-secret@example.com/test');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /super-secret|private-user|example.com/);
});
test('temporary verification requires existing binaries and installs nothing', () => {
  const result = run(undefined, ['--temporary']);
  assert.equal(result.status, 1); assert.match(result.stderr, /PG_BIN/);
  assert.doesNotMatch(result.stdout, /PASS/);
});
