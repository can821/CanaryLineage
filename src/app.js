import express from 'express';
import { explorerRouter } from './explorer.js';
import { compareTraces } from './comparison.js';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { UUID } from './canary.js';
import { formatTrace, completeTrace } from './tracker.js';
import { traceRequest, failedTrace, observe } from './instrumentation.js';
import { createUser } from './service.js';

export function createApp({ repository, sendEmail }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    next();
  });
  app.use('/api/explorer', explorerRouter());
  app.use(express.json({ limit: '8kb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await repository.health();
      res.json({ status: 'ready', storage: repository.mode, outbound: Boolean(sendEmail) });
    } catch {
      res.status(503).json({ status: 'unavailable', storage: repository.mode, error: 'PostgreSQL or its tables are unavailable. Check npm run db:init.' });
    }
  });

  app.post('/api/signup', traceRequest(repository.mode), async (req, res) => {
    if (req.canaryInput.scenario !== 'storage' && !sendEmail) throw new AppError(503, 'HTTP_NOT_CONFIGURED', 'The local HTTP service is not configured.');
    const result = await createUser({ ...req.canaryInput, repository, sendEmail });
    const trace = completeTrace(res.locals.trace);
    try {
      if (!await repository.finishTrace(trace)) throw new Error('No trace row');
    } catch {
      observe({ stage: 'error', location: 'Trace store', value: trace.canary, metadata: { operation: 'FINALIZE_TRACE' } });
      throw new AppError(503, 'TRACE_STORE_FAILED', 'Operations finished, but the final trace state could not be saved.');
    }
    res.locals.trace.status = 'completed';
    res.status(201).json({ ...result, trace, traceSaved: true, readable: formatTrace(trace) });
  });

  app.get('/api/compare', async (req, res) => {
    const { baseline, current } = req.query;
    if (typeof baseline !== 'string' || typeof current !== 'string' || !UUID.test(baseline) || !UUID.test(current)) {
      throw new AppError(400, 'INVALID_COMPARISON', 'Valid trace UUIDs are required for baseline and current.');
    }
    const [before, after] = await Promise.all([repository.getTrace(baseline), repository.getTrace(current)]);
    if (!before || !after) throw new AppError(404, 'TRACE_NOT_FOUND', 'A trace to compare was not found. Demo memory is cleared on restart.');
    res.json(compareTraces(before, after));
  });

  app.get('/api/traces/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) throw new AppError(400, 'INVALID_TRACE_ID', 'A valid trace UUID is required.');
    const trace = await repository.getTrace(req.params.id);
    if (!trace) throw new AppError(404, 'TRACE_NOT_FOUND', 'Trace not found. Demo memory is cleared on restart.');
    res.json({ trace, readable: formatTrace(trace) });
  });

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(async (error, _req, res, _next) => {
    const trace = res.locals.trace ? failedTrace(res.locals.trace) : undefined;
    let traceSaved = false;
    if (trace) {
      try { traceSaved = await repository.finishTrace(trace); }
      catch { /* Return partial evidence even if the trace store is unavailable. */ }
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON.' } });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'The request exceeds the 8 KB limit.' } });
    if (error instanceof AppError) return res.status(error.status).json({ error: { code: error.code, message: error.message }, trace, traceSaved });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error; persistence could not be confirmed.' }, trace, traceSaved });
  });
  return app;
}
