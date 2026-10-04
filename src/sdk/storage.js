/** Independent trace storage, not a user repository. No silent fallback. */
export function memoryTraceStore({ limit = 500 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid store limit');
  const traces = new Map();
  return {
    mode: 'memory-demo',
    async saveTrace(trace) {
      if (!traces.has(trace.id) && traces.size >= limit) throw new Error('Store full');
      traces.set(trace.id, structuredClone(trace));
    },
    async getTrace(id) { return structuredClone(traces.get(id) ?? null); },
  };
}
