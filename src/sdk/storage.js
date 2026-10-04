/** Independent trace storage, not a user repository. No silent fallback. */
export function memoryTraceStore({ limit = 500 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid store limit');
  const traces = new Map();
  return {
    mode: 'memory-demo',
    async saveTrace(trace) {
      const key = trace.segmentId ? `${trace.id}/${trace.segmentId}` : trace.id;
      if (!traces.has(key) && traces.size >= limit) throw new Error('Store full');
      traces.set(key, structuredClone(trace));
    },
    async getSegments(id) { return [...traces.values()].filter(t=>t.id===id).map(t=>structuredClone(t)); },
    async getTrace(id) { return structuredClone(traces.get(id) ?? null); },
  };
}
