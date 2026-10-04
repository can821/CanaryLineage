import { randomUUID } from 'node:crypto';

// Each request owns its trace. No shared "current email" or global event list.
export function startTrace(value, storage) {
  return { schemaVersion: 1, id: randomUUID(), canary: value, storage, status: 'pending', startedAt: new Date().toISOString(), events: [] };
}

export function record(trace, { stage, location, value, canaryIds, parentId = null, metadata = {}, status = 'observed', evidence = 'server-observed', occurredAt = new Date().toISOString() }) {
  if (trace.status !== 'pending') throw new Error('Cannot append to a completed trace.');
  if (trace.schemaVersion >= 2) {
    if (!Array.isArray(canaryIds) || !canaryIds.length || canaryIds.some(id => !trace.canaries.some(c => c.id === id))) throw new Error('Unknown canary identity');
  } else if (value !== trace.canary) throw new Error('Canary changed between observation points.');
  const sequence = trace.events.length + 1;
  const types = { browser: 'BROWSER_INPUT', http: 'HTTP_INPUT', function: 'FUNCTION', database: 'DATABASE_WRITE', 'demo-store': 'DEMO_WRITE', 'http-output': 'HTTP_OUTPUT', error: 'ERROR' };
  const event = { id: `${trace.id}:${sequence}`, parentId, sequence, type: types[stage] ?? stage, stage, location, value, evidence, occurredAt, status: stage === 'error' ? 'failed' : status, metadata: structuredClone(metadata) };
  if (trace.schemaVersion >= 2) { delete event.value; event.canaryIds = [...canaryIds]; event.serviceName = trace.serviceName; }
  if (trace.schemaVersion >= 3) { event.id = randomUUID(); event.traceId = trace.id; event.segmentId = trace.segmentId; event.schemaVersion = 3; }
  trace.events.push(event);
  return event;
}

export function completeTrace(trace) {
  return { ...structuredClone(trace), status: 'completed', finishedAt: new Date().toISOString() };
}

export function formatTrace(trace) {
  const lines = [trace.canary];
  const visit = (parentId, indent = '') => {
    const children = trace.events.filter(event => event.parentId === parentId);
    children.forEach((event, index) => {
      const last = index === children.length - 1;
      lines.push(`${indent}${last ? '└─' : '├─'} ${event.location} [${event.status}]`);
      visit(event.id, `${indent}${last ? '   ' : '│  '}`);
    });
  };
  visit(null);
  return `${lines.join('\n')}\n[${trace.storage}; ${trace.status}]`;
}
