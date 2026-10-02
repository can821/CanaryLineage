import express from 'express';
import { once } from 'node:events';
import { validateSubmission } from '../canary.js';

// A real HTTP listener in the same process. No email is delivered, no data retained.
export async function startMockServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.post(['/mock-email', '/mock-email/fail'], (req, res) => {
    try { validateSubmission(req.body); }
    catch { return res.status(400).json({ accepted: false }); }
    res.status(req.path.endsWith('/fail') ? 503 : 204).end();
  });
  app.use((_error, _req, res, _next) => res.status(400).json({ accepted: false }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
