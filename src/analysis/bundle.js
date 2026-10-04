import { createHash } from 'node:crypto';
import { buildGraph } from './graph.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function exportBundle(input){
  const graph=buildGraph(input);const segments=Array.isArray(input)?input:[input];
  const safe=segments.map(segment=>{
    const copy={...(segment.propagationTrust?{propagationTrust:segment.propagationTrust}:{}),...(segment.diagnostics?{diagnostics:segment.diagnostics.filter(d=>['RESOURCE_LIMIT','ROW_INSPECTION_LIMIT','TRACE_STORE_FAILED','INSTRUMENTATION_REJECTED','PROPAGATION_REJECTED','UNSUPPORTED_QUERY_RESULT'].includes(d.code)).map(d=>({code:d.code}))}:{}),schemaVersion:segment.schemaVersion,id:segment.id,serviceName:segment.serviceName??'legacy',status:segment.status,incomplete:Boolean(segment.incomplete),startedAt:segment.startedAt,finishedAt:segment.finishedAt};
    if(segment.segmentId)copy.segmentId=segment.segmentId;
    if(segment.schemaVersion>=2)copy.canaries=segment.canaries.map(c=>({id:c.id,label:c.label,category:c.category,parentCanaryIds:c.parentCanaryIds,operation:c.operation,depth:c.depth}));
    copy.events=segment.events.map(e=>{
      const safeEvent=graph.nodes.events.find(n=>n.id===e.id);
      return {id:e.id,parentId:e.parentId,type:e.type,location:e.location,status:e.status,...(safeEvent.occurredAt?{occurredAt:safeEvent.occurredAt}:{}),...(e.sequence?{sequence:e.sequence}:{}),metadata:safeEvent.metadata,...(segment.schemaVersion>=2?{canaryIds:e.canaryIds}:{}),...(segment.schemaVersion>=3?{traceId:segment.id,segmentId:segment.segmentId}:{} )};
    });
    return copy;
  });
  const payload={schemaVersion:1,toolVersion:'0.3.0',createdAt:new Date().toISOString(),segments:safe};
  return {...payload,checksum:hash(payload)};
}
export function importBundle(bundle){
  if(!bundle||Object.keys(bundle).sort().join(',')!=='checksum,createdAt,schemaVersion,segments,toolVersion'||bundle.schemaVersion!==1||typeof bundle.checksum!=='string')throw new Error('Invalid trace bundle');
  const {checksum,...payload}=bundle;
  if(hash(payload)!==checksum)throw new Error('Trace bundle checksum mismatch');
  buildGraph(payload.segments);
  return payload.segments;
}
