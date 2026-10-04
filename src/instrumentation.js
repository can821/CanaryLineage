import { AsyncLocalStorage } from 'node:async_hooks';
import { record, startTrace } from './tracker.js';
import { validateSubmission } from './canary.js';
import { AppError } from './errors.js';

// run(), rather than enterWith(), keeps sibling requests and async branches isolated.
const context = new AsyncLocalStorage();

export function runWithTrace(trace, operation, parentId = null) {
  return context.run({ trace, parentId }, operation);
}

// Shared by the demo and SDK; run() restores the caller's parent after completion.
export function withParent(parentId, operation) {
  const trace = currentTrace();
  return context.run({ trace, parentId }, operation);
}

export function currentTrace() {
  const store = context.getStore();
  if (!store) throw new Error('CanaryLineage trace context is missing.');
  return store.trace;
}

export function observe(event) {
  const store = context.getStore();
  if (!store) throw new Error('CanaryLineage trace context is missing.');
  return record(store.trace, { ...event, parentId: store.parentId });
}

// Register this once at a validated HTTP boundary. Business handlers receive only data.
export function traceRequest(storage) {
  return (req, res, next) => {
    if (!req.is('application/json')) return next(new AppError(415, 'JSON_REQUIRED', 'Content-Type: application/json gerekli.'));
    let input;
    try { input = validateSubmission(req.body); }
    catch (error) { return next(error); }
    const trace = startTrace(input.email, storage);
    res.locals.trace = trace;
    req.canaryInput = input;
    res.once('finish', () => {
      if (trace.status === 'pending') trace.status = res.statusCode < 400 ? 'completed' : 'failed';
    });
    runWithTrace(trace, () => {
      if (input.browserEvent) observe({ stage: 'browser', location: 'Browser: signup form', value: input.email, evidence: 'client-reported', occurredAt: input.browserEvent.occurredAt });
      const event = observe({ stage: 'http', location: 'POST /api/signup', value: input.email, status: 'success', metadata: { method: 'POST' } });
      context.run({ trace, parentId: event.id }, next);
    });
  };
}

export function tracedFunction(name, getValue, operation) {
  return async function (...args) {
    const trace = currentTrace();
    const event = observe({ stage: 'function', location: `${name}()`, value: getValue(...args), status: 'pending' });
    return context.run({ trace, parentId: event.id }, async () => {
      try {
        const result = await operation.apply(this, args);
        event.status = 'success';
        return result;
      }
      catch (error) {
        // No raw exception messages or arguments enter the trace.
        event.status = 'failed';
        throw error;
      }
    });
  };
}

export function observeWrite(storage, value) {
  const postgres = storage === 'postgres';
  return observe({
    stage: postgres ? 'database' : 'demo-store',
    location: postgres ? 'PostgreSQL: users.email' : 'Memory: users.email (not PostgreSQL)',
    value, status: 'pending', evidence: postgres ? 'server-observed' : 'demo-only',
    metadata: { table: 'users', column: 'email', operation: 'INSERT', persistence: postgres ? 'transaction' : 'volatile' },
  });
}

export function failedTrace(trace) {
  trace.status = 'failed';
  trace.finishedAt = new Date().toISOString();
  // Keep earlier committed/successful boundaries intact when a later boundary fails.
  for (const event of trace.events) {
    if (event.status === 'pending') event.status = 'unconfirmed';
  }
  return structuredClone(trace);
}
