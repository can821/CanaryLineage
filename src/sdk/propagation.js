export const PROPAGATION_HEADER = 'x-canary-lineage-context';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const name = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value);
const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object,key));

// Structural validation is not authentication. Only trusted application peers may be accepted.
export function parsePropagation(header, { trusted = false, maxBytes = 8192 } = {}) {
  if (header === undefined || header === null) return null;
  if (!trusted || typeof header !== 'string' || header.length > maxBytes || !/^[A-Za-z0-9_-]+$/.test(header)) throw new Error('Invalid or untrusted lineage context');
  const bytes = Buffer.from(header, 'base64url');
  if (bytes.toString('base64url') !== header) throw new Error('Noncanonical lineage context');
  let context;
  try { context = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid lineage encoding'); }
  if (!exact(context,['version','traceId','segmentId','parentEventId','sourceService','targetService','canaries']) || context.version !== 1 || ![context.traceId,context.segmentId,context.parentEventId].every(v=>typeof v==='string'&&uuid.test(v)) || !name(context.sourceService) || !name(context.targetService) || !Array.isArray(context.canaries) || !context.canaries.length || context.canaries.length > 64) throw new Error('Invalid lineage structure');
  const ids = new Map(); const labels = new Set();
  for (const c of context.canaries) {
    if (!exact(c,['id','label','category','parentCanaryIds','operation','depth']) || !uuid.test(c.id) || ids.has(c.id) || !name(c.label) || labels.has(c.label) || !name(c.category) || !Array.isArray(c.parentCanaryIds) || c.parentCanaryIds.length > 64 || new Set(c.parentCanaryIds).size !== c.parentCanaryIds.length || c.parentCanaryIds.some(id=>!ids.has(id)) || !Number.isInteger(c.depth) || c.depth < 0 || c.depth > 64 || !(c.operation===null || name(c.operation))) throw new Error('Invalid propagated identity');
    const expectedDepth = c.parentCanaryIds.length ? 1+Math.max(...c.parentCanaryIds.map(id=>ids.get(id).depth)) : 0;
    if(c.depth!==expectedDepth || Boolean(c.parentCanaryIds.length)!==Boolean(c.operation)) throw new Error('Invalid propagated ancestry');
    ids.set(c.id,c); labels.add(c.label);
  }
  return context;
}
export function encodePropagation(context, maxBytes=8192) {
  const header=Buffer.from(JSON.stringify(context)).toString('base64url');
  parsePropagation(header,{trusted:true,maxBytes});
  return header;
}
