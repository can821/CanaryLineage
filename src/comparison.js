// Compare observed boundary identities, not payloads, timing or delivery outcomes.
function sink(event) {
  const m = event.metadata ?? {};
  if (event.type === 'DATABASE_WRITE' || event.type === 'DEMO_WRITE') {
    const identity = ['STORAGE_WRITE', m.table, m.column, m.operation];
    return { id: JSON.stringify(identity), type: 'STORAGE_WRITE', destination: `${m.table}.${m.column}`, operation: m.operation };
  }
  if (event.type === 'HTTP_OUTPUT') {
    // The mock failure route is the same logical operation with an injected failure.
    // Keep compatibility with traces recorded before comparison was introduced.
    const path = m.sinkPath ?? (m.destination === 'mock-email-service' && m.path === '/mock-email/fail' ? '/mock-email' : m.path);
    const identity = ['HTTP_OUTPUT', m.destination, m.method, path];
    return { id: JSON.stringify(identity), type: 'HTTP_OUTPUT', destination: m.destination, operation: m.method, path };
  }
  return null;
}

function sinks(trace) {
  const result = new Map();
  for (const event of trace.events) {
    const value = sink(event);
    if (value) result.set(value.id, value);
  }
  return result;
}

export function compareTraces(baseline, current) {
  const before = sinks(baseline);
  const after = sinks(current);
  const sorted = values => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    baselineTraceId: baseline.id, currentTraceId: current.id,
    baselineStorage: baseline.storage, currentStorage: current.storage,
    baselineStatus: baseline.status, currentStatus: current.status,
    semantics: 'Observed or attempted destinations; not proof of delivery or privacy violation. Missing destinations may reflect an incomplete or failed execution. Storage identity compares logical table/column/operation, not physical databases.',
    addedSinks: sorted([...after.values()].filter(value => !before.has(value.id))),
    removedSinks: sorted([...before.values()].filter(value => !after.has(value.id))),
    unchangedSinks: sorted([...after.values()].filter(value => before.has(value.id))),
  };
}
