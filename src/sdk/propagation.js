import { createHmac, timingSafeEqual } from 'node:crypto';
export const PROPAGATION_HEADER = 'x-canary-lineage-context';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const name = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value);
const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object,key));

// Structural validation is not authentication. Only trusted application peers may be accepted.
export function parsePropagation(header, { trusted = false, maxBytes = 8192, authentication, now = Date.now() } = {}) {
  if (header === undefined || header === null) return null;
  if (typeof header !== 'string' || header.length > maxBytes || !/^[A-Za-z0-9_-]+$/.test(header)) throw new Error('Invalid or untrusted lineage context');
  const bytes = Buffer.from(header, 'base64url');
  if (bytes.toString('base64url') !== header) throw new Error('Noncanonical lineage context');
  let context;
  try { context = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid lineage encoding'); }
  if(context?.version===2){
    const config=authenticationConfig(authentication);
    if(!config || !name(context.keyId) || !exact(context,['version','keyId','issuedAt','context','signature']) || !Object.hasOwn(config.keys,context.keyId) || !Number.isSafeInteger(context.issuedAt) || context.issuedAt>now+30000 || now-context.issuedAt>config.maxAgeMs || typeof context.signature!=='string' || !/^[a-f0-9]{64}$/.test(context.signature))throw new Error('Propagation authentication rejected');
    const {signature,...material}=context;
    const expected=createHmac('sha256',config.keys[context.keyId]).update(canonical(material)).digest();
    if(!timingSafeEqual(Buffer.from(signature,'hex'),expected))throw new Error('Propagation authentication rejected');
    const decoded=parsePropagation(Buffer.from(JSON.stringify(context.context)).toString('base64url'),{trusted:true,maxBytes});
    Object.defineProperty(decoded,'authentication',{value:'verified'});return decoded;
  }
  if(!trusted || authentication?.requireSigned)throw new Error('Unsigned lineage context rejected');
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
export function encodePropagation(context, maxBytes=8192, authentication, now=Date.now()) {
  const header=Buffer.from(JSON.stringify(context)).toString('base64url');
  parsePropagation(header,{trusted:true,maxBytes});
  const config=authenticationConfig(authentication);
  if(!config)return header;
  const material={version:2,keyId:config.activeKeyId,issuedAt:now,context};
  const signature=createHmac('sha256',config.keys[config.activeKeyId]).update(canonical(material)).digest('hex');
  const signed=Buffer.from(JSON.stringify({...material,signature})).toString('base64url');
  if(signed.length>maxBytes)throw new Error('Propagation limit exceeded');
  return signed;
}

// Canonical key order is independent of JSON property insertion order.
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function authenticationConfig(config){
  if(config===undefined)return null;
  if(!config||!name(config.activeKeyId)||!config.keys||typeof config.keys!=='object'||Array.isArray(config.keys)||Object.keys(config).some(k=>!['activeKeyId','keys','requireSigned','maxAgeMs'].includes(k))||Object.keys(config.keys).length>8||!Object.hasOwn(config.keys,config.activeKeyId)||Object.entries(config.keys).some(([id,key])=>!name(id)||typeof key!=='string'||Buffer.byteLength(key)<32)||!['boolean','undefined'].includes(typeof config.requireSigned))throw new Error('Invalid propagation authentication configuration');
  const maxAgeMs=config.maxAgeMs??300000;
  if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>86400000)throw new Error('Invalid propagation expiry');
  return {...config,keys:{...config.keys},maxAgeMs};
}
