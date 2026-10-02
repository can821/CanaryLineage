import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

export const canary = () => `canary+${randomUUID()}@example.test`;
export function submission(email = canary()) {
  return { email, browserEvent: { value: email, occurredAt: new Date().toISOString() } };
}
export async function serve(t, repository, options = {}) {
  const server = createApp({ repository, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: path => fetch(`${base}${path}`),
    post: (body, options = {}) => fetch(`${base}/api/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
    }),
  };
}
