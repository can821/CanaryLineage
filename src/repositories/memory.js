import { randomUUID } from 'node:crypto';
import { currentTrace, observeWrite } from '../instrumentation.js';
import { AppError } from '../errors.js';

// Explicit demo/test adapter. Never selected automatically after a DB failure.
export function memoryRepository({ limit = 500 } = {}) {
  const emails = new Set();
  const traces = new Map();
  return {
    mode: 'memory-demo',
    async health() {},
    async saveUser(email) {
      const trace = currentTrace();
      if (emails.has(email)) throw new AppError(409, 'CANARY_EXISTS', 'Bu canary zaten kaydedildi. Yeni bir canary üret.');
      if (traces.size >= limit) throw new AppError(503, 'DEMO_FULL', 'Demo doldu. Belleği temizlemek için sunucuyu yeniden başlat.');
      const user = { id: randomUUID(), email, created_at: new Date().toISOString() };
      const event = observeWrite('memory-demo', user.email);
      event.status = 'success';
      emails.add(email);
      traces.set(trace.id, structuredClone(trace));
      return { user };
    },
    async finishTrace(trace) {
      if (!traces.has(trace.id)) return false;
      traces.set(trace.id, structuredClone(trace));
      return true;
    },
    async getTrace(id) {
      return structuredClone(traces.get(id) ?? null);
    },
  };
}
