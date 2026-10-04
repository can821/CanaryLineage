import { encodePropagation, parsePropagation, PROPAGATION_HEADER } from './propagation.js';
export { parsePropagation, PROPAGATION_HEADER } from './propagation.js';
import { randomUUID } from 'node:crypto';
import { runWithTrace, currentTrace, withParent, observe as recordObservation } from '../instrumentation.js';
export { compareTraces } from '../comparison.js';
export { memoryTraceStore } from './storage.js';
export { postgresAdapter, postgresTraceStore } from './postgres.js';

const TYPES = new Set(['FUNCTION', 'HTTP_INPUT', 'HTTP_OUTPUT', 'DATABASE_WRITE', 'DATABASE_READ']);
const text = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Explicit synthetic-data SDK. Store contract: async saveTrace(document), getTrace(id). */
export function createCanaryLineage({ serviceName, storage, failureMode = 'open', limits = {}, distributed = false, allowedOrigins = [] } = {}) {
  if (!text(serviceName) || !['open', 'strict'].includes(failureMode)) throw new Error('Invalid SDK configuration');
  if (storage && (typeof storage.saveTrace !== 'function' || typeof storage.getTrace !== 'function')) throw new Error('Invalid trace store');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => typeof origin !== 'string' || new URL(origin).origin !== origin)) throw new Error('Invalid allowed origins');
  const origins = new Set(allowedOrigins);
  const budget = { maxEvents: 1000, maxCanaries: 64, maxDepth: 16, maxValueBytes: 4096, maxMetadataBytes: 2048, maxPropagationBytes: 8192, ...limits };
  for (const [key, value] of Object.entries(budget)) {
    if (!['maxEvents','maxCanaries','maxDepth','maxValueBytes','maxMetadataBytes','maxPropagationBytes'].includes(key) || !Number.isSafeInteger(value) || value < 1 || value > 1000000) throw new Error('Invalid SDK limit');
  }
  const owner = Symbol('sdk');
  const owned = new WeakSet();
  const handles = new WeakMap();
  function active() {
    const trace = currentTrace();
    if (!owned.has(trace) || trace.status !== 'pending') throw new Error('No active trace for this SDK');
    return trace;
  }
  function guard(fn) {
    const trace = active();
    try { return fn(trace); }
    catch (error) {
      trace.incomplete = true;
      if (trace.diagnostics.length < 8) trace.diagnostics.push({ code: 'INSTRUMENTATION_REJECTED' });
      if (failureMode === 'strict') throw error;
      return null;
    }
  }
  function resolve(trace, refs) {
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > budget.maxCanaries) throw new Error('Canary references required');
    return [...new Set(refs.map(ref => {
      const registered = handles.get(ref);
      if (!registered || registered.owner !== owner || registered.trace !== trace) throw new Error('Canary belongs to another trace');
      return registered.canary;
    }))];
  }
  function newCanary(trace, { label, value, category = 'synthetic' }, parents = [], operation = null) {
    if (!text(label) || !text(category) || typeof value !== 'string' || Buffer.byteLength(value) > budget.maxValueBytes) throw new Error('Invalid canary');
    if (trace.canaries.some(c => c.label === label)) throw new Error('Canary labels must be unique within a trace');
    if (trace.canaries.length >= budget.maxCanaries) throw new Error('Canary limit exceeded');
    const depth = parents.length ? 1 + Math.max(...parents.map(c => c.depth)) : 0;
    if (depth > budget.maxDepth) throw new Error('Transformation depth exceeded');
    const canary = { id: randomUUID(), label, category, value, parentCanaryIds: parents.map(c => c.id), operation, depth };
    const ref = Object.freeze({ id: canary.id, label, value });
    trace.canaries.push(canary);
    handles.set(ref, { owner, trace, canary });
    return ref;
  }
  function append(trace, { type, location, refs, metadata = {}, status = 'observed' }) {
    if (!text(location) || !['observed', 'pending', 'success', 'failed'].includes(status)) throw new Error('Invalid boundary');
    if (trace.events.length >= budget.maxEvents) throw new Error('Event limit exceeded');
    const canaries = resolve(trace, refs);
    const safe = JSON.stringify(metadata);
    if (!safe || Buffer.byteLength(safe) > budget.maxMetadataBytes || !metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Invalid metadata');
    return recordObservation({ stage: type, location, canaryIds: canaries.map(c => c.id), metadata: JSON.parse(safe), status });
  }
  const api = {
    reportIssue(code) {
      if (!['ROW_INSPECTION_LIMIT', 'UNSUPPORTED_QUERY_RESULT'].includes(code)) throw new Error('Unsupported diagnostic');
      const trace = active(); trace.incomplete = true;
      if (trace.diagnostics.length < 8) trace.diagnostics.push({ code });
      if (failureMode === 'strict') throw new Error(code);
    },
    async run({ canaries, synthetic = false, propagation, trusted = false }, operation) {
      if (synthetic !== true || !Array.isArray(canaries) || canaries.length === 0 || typeof operation !== 'function') throw new Error('Explicit synthetic canaries and callback required');
      let incoming = null; let propagationRejected = false;
      if (propagation !== undefined) {
        try {
          if (!distributed) throw new Error('Distributed tracing is not enabled');
          incoming = parsePropagation(propagation, { trusted, maxBytes: budget.maxPropagationBytes });
          if (incoming && incoming.targetService !== serviceName) throw new Error('Wrong target service');
          if (incoming && (incoming.canaries.length > budget.maxCanaries || incoming.canaries.some(c=>c.depth > budget.maxDepth))) throw new Error('Incoming context exceeds local limits');
        } catch {
          if (failureMode === 'strict') throw new Error('Propagation rejected');
          incoming = null; propagationRejected = true;
        }
      }
      const trace = { schemaVersion: distributed ? 3 : 2, id: randomUUID(), serviceName, storage: storage?.mode ?? 'none', status: 'pending', startedAt: new Date().toISOString(), canaries: [], events: [], diagnostics: [], incomplete: false };
      if (distributed) { trace.segmentId = randomUUID(); trace.parentEventId = incoming?.parentEventId ?? null; }
      if (incoming) { trace.id = incoming.traceId; trace.sourceService = incoming.sourceService; trace.canaries = structuredClone(incoming.canaries); }
      if (propagationRejected) { trace.incomplete = true; trace.diagnostics.push({code:'PROPAGATION_REJECTED'}); }
      owned.add(trace);
      const bound = new Set();
      const refs = canaries.map(c => {
        const inherited = incoming && trace.canaries.find(item=>item.label===c.label);
        if (!inherited) return newCanary(trace,c);
        if (bound.has(c.label) || typeof c.value !== 'string' || Buffer.byteLength(c.value)>budget.maxValueBytes) throw new Error('Invalid incoming binding');
        bound.add(c.label); inherited.value=c.value;
        const ref=Object.freeze({id:inherited.id,label:inherited.label,value:c.value});
        handles.set(ref,{owner,trace,canary:inherited}); return ref;
      });
      let result, businessError, businessFailed = false;
      await runWithTrace(trace, async () => {
        try {
          if (incoming) {
            const event=guard(t=>append(t,{type:'HTTP_INPUT',location:serviceName,refs,status:'success',metadata:{sourceService:incoming.sourceService}}));
            result=event ? await withParent(event.id,()=>operation(refs)) : await operation(refs);
          } else result = await operation(refs);
        }
        catch (error) { businessFailed = true; businessError = error; }
      }, trace.parentEventId ?? null);
      trace.status = businessFailed ? 'failed' : 'completed';
      trace.finishedAt = new Date().toISOString();
      let traceSaved = false;
      if (storage) {
        try { await storage.saveTrace(structuredClone(trace)); traceSaved = true; }
        catch {
          trace.incomplete = true;
          if (trace.diagnostics.length < 8) trace.diagnostics.push({ code: 'TRACE_STORE_FAILED' });
          if (!businessFailed && failureMode === 'strict') throw new Error('Trace storage failed');
        }
      }
      if (businessFailed) throw businessError; // Never replace an application error with instrumentation failure.
      return { result, trace: structuredClone(trace), traceSaved };
    },
    async http({ url, targetService, canaries, body, method = 'POST', timeoutMs = 2000, propagate = true }) {
      const endpoint = new URL(url);
      if (!origins.has(endpoint.origin) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['http:', 'https:'].includes(endpoint.protocol) || !text(targetService) || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000 || !['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('HTTP target/configuration rejected');
      const event=guard(trace=>append(trace,{type:'HTTP_OUTPUT',location:targetService,refs:canaries,status:'pending',metadata:{destination:targetService,targetService,method,path:endpoint.pathname}}));
      let header;
      if (event && propagate) header=guard(trace=>{
        if (!distributed) throw new Error('Distributed mode required');
        const needed=new Set();
        const include=c=>{ if(needed.has(c.id))return; c.parentCanaryIds.forEach(id=>include(trace.canaries.find(item=>item.id===id))); needed.add(c.id); };
        resolve(trace,canaries).forEach(include);
        return encodePropagation({version:1,traceId:trace.id,segmentId:trace.segmentId,parentEventId:event.id,sourceService:serviceName,targetService,
          canaries:trace.canaries.filter(c=>needed.has(c.id)).map(({id,label,category,parentCanaryIds,operation,depth})=>({id,label,category,parentCanaryIds,operation,depth}))},budget.maxPropagationBytes);
      });
      try {
        const response=await fetch(endpoint,{method,body,headers:header?{[PROPAGATION_HEADER]:header}:{},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
        if(event){event.status=response.ok?'success':'failed';event.metadata.httpStatus=response.status;}
        return response;
      } catch(error) { if(event)event.status='failed'; throw error; }
    },
    observe({ type, location, canaries, metadata, status }) {
      return guard(trace => {
        if (!TYPES.has(type)) throw new Error('Unsupported boundary type');
        const event = append(trace, { type, location, refs: canaries, metadata, status });
        return Object.freeze({ id: event.id });
      });
    },
    derive({ parents, value, label, operation, description }) {
      return guard(trace => {
        if (!text(operation) || (description !== undefined && !text(description, 512))) throw new Error('Invalid transformation');
        const sources = resolve(trace, parents);
        // Validate capacity before mutating the canary registry.
        if (trace.events.length >= budget.maxEvents) throw new Error('Event limit exceeded');
        const metadata = { operation, parentCanaryIds: sources.map(c => c.id), ...(description === undefined ? {} : { description }) };
        if (Buffer.byteLength(JSON.stringify(metadata)) > budget.maxMetadataBytes) throw new Error('Metadata limit exceeded');
        const ref = newCanary(trace, { label, value, category: 'derived' }, sources, operation);
        append(trace, { type: 'TRANSFORMATION', location: operation, refs: [ref], metadata, status: 'success' });
        return ref;
      });
    },
    async span(name, canaries, operation) {
      if (typeof operation !== 'function') throw new Error('Callback required');
      const event = guard(trace => append(trace, { type: 'FUNCTION', location: name, refs: canaries, status: 'pending' }));
      const execute = async () => {
        try { const result = await operation(); if (event) event.status = 'success'; return result; }
        catch (error) { if (event) event.status = 'failed'; throw error; }
      };
      return event ? withParent(event.id, execute) : execute();
    },
  };
  return Object.freeze(api);
}
