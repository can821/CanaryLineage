const string = (v, max=256) => typeof v==='string' && v.length>0 && v.length<=max;
const types = new Set(['BROWSER_INPUT','HTTP_INPUT','FUNCTION','TRANSFORMATION','DATABASE_READ','DATABASE_WRITE','DEMO_WRITE','HTTP_OUTPUT','ERROR']);
const ordered = values => [...values].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
const fail = () => { throw new Error('Invalid or unsupported trace graph'); };

/** Build value-free graph/facts from v1/v2 traces or collected v3 service segments. */
export function buildGraph(input) {
  const segments=Array.isArray(input)?input:[input];
  if(!segments.length || segments.length>128)fail();
  const events=new Map(),canaries=new Map(),services=new Set(),segmentIds=new Set();
  let traceId;let complete=true;
  for(const trace of segments){
    if(!trace || ![1,2,3].includes(trace.schemaVersion) || !string(trace.id,128) || !Array.isArray(trace.events) || trace.events.length>10000 || !['pending','completed','failed'].includes(trace.status))fail();
    if(traceId && traceId!==trace.id)fail();traceId=trace.id;
    const service=trace.serviceName??'legacy';if(!string(service,128))fail();services.add(service);
    const segment=trace.segmentId??trace.id;if(!string(segment,128)||segmentIds.has(segment))fail();segmentIds.add(segment);
    if(trace.incomplete || trace.status==='pending')complete=false;
    const registry=trace.schemaVersion===1?[{id:`${trace.id}:canary`,label:'canary',category:'synthetic',parentCanaryIds:[],operation:null}]:trace.canaries;
    if(!Array.isArray(registry)||registry.length>256)fail();
    const local=new Set();
    for(const c of registry){
      if(!c || !string(c.id,128)||local.has(c.id)||!string(c.label,128)||!Array.isArray(c.parentCanaryIds)||c.parentCanaryIds.length>64||c.parentCanaryIds.some(id=>!string(id,128))||!(c.operation===null||string(c.operation,128)))fail();
      local.add(c.id);
      const descriptor={id:c.id,label:c.label,parentCanaryIds:[...c.parentCanaryIds],operation:c.operation};
      if(canaries.has(c.id)&&JSON.stringify(canaries.get(c.id))!==JSON.stringify(descriptor))fail();
      canaries.set(c.id,descriptor);
    }
    for(const event of trace.events){
      if(!event || !string(event.id,128)||events.has(event.id)||!types.has(event.type)||!string(event.location)||!(event.parentId===null||string(event.parentId,128))||!['pending','success','failed','observed','unconfirmed'].includes(event.status)||!event.metadata||typeof event.metadata!=='object'||Array.isArray(event.metadata))fail();
      if(trace.schemaVersion===3 && (event.segmentId!==trace.segmentId||event.traceId!==trace.id))fail();
      const ids=trace.schemaVersion===1?[registry[0].id]:event.canaryIds;
      if(!Array.isArray(ids)||!ids.length||ids.length>256||ids.some(id=>!local.has(id)))fail();
      const metadata={};
      for(const key of ['table','column','operation','destination','method','path','sinkPath','targetService','sourceService','propagation']){
        if(event.metadata[key]!==undefined){if(!string(event.metadata[key],256))fail();metadata[key]=event.metadata[key];}
      }
      events.set(event.id,{id:event.id,parentId:event.parentId,type:event.type,location:event.location,service,canaryIds:[...ids],metadata,status:event.status});
    }
  }
  if(events.size>10000 || canaries.size>1024)fail();
  if([...events.keys()].some(id=>canaries.has(id)))fail();
  const ancestry=new Map();
  function transforms(id,stack=new Set()){
    if(ancestry.has(id))return ancestry.get(id);
    if(stack.has(id)||stack.size>64||!canaries.has(id))fail();
    const c=canaries.get(id);const next=new Set([...stack,id]);
    const result=[...new Set([...c.parentCanaryIds.flatMap(p=>transforms(p,next)),...(c.operation?[c.operation]:[])])];
    ancestry.set(id,result);return result;
  }
  for(const id of canaries.keys())transforms(id);
  const paths=new Map();
  function path(id,stack=new Set()){
    if(paths.has(id))return paths.get(id);
    if(stack.has(id)||stack.size>128)fail();
    const e=events.get(id);if(!e){complete=false;return [];}
    const result=[...(e.parentId?path(e.parentId,new Set([...stack,id])):[]),{service:e.service,type:e.type,operation:e.location}];
    paths.set(id,result);return result;
  }
  for (const e of events.values()) if (e.metadata.propagation === 'lineage-v1' && ![...events.values()].some(child=>child.parentId===e.id&&child.type==='HTTP_INPUT')) complete=false;
  const edges=[];const facts=[];const destinations=new Map();
  for(const c of canaries.values())for(const parent of c.parentCanaryIds)edges.push({from:parent,to:c.id,type:'DERIVED_FROM'});
  for(const e of events.values()){
    const route=path(e.id);
    if(e.parentId&&events.has(e.parentId))edges.push({from:e.parentId,to:e.id,type:'CALLED'});
    for(const id of e.canaryIds)edges.push({from:id,to:e.id,type:'OBSERVED_AT'});
    const m=e.metadata;let destination=null;
    if(['DATABASE_WRITE','DEMO_WRITE','DATABASE_READ'].includes(e.type)){
      if(!m.table||!m.column||!m.operation)fail();
      destination={category:e.type==='DATABASE_READ'?'database_read':'database',name:`${m.table}.${m.column}`,operation:m.operation};
    }else if(e.type==='HTTP_OUTPUT'){
      if(!m.destination||!m.method||!(m.sinkPath||m.path))fail();
      destination={category:'http',name:m.destination,operation:m.method,path:m.sinkPath??(m.destination==='mock-email-service'&&m.path==='/mock-email/fail'?'/mock-email':m.path)};
    }
    if(destination){
      const destinationId=`destination:${JSON.stringify(destination)}`;destinations.set(destinationId,{id:destinationId,...destination});
      edges.push({from:e.id,to:destinationId,type:e.type==='DATABASE_READ'?'READ_FROM':e.type==='HTTP_OUTPUT'?'SENT_TO':'WRITTEN_TO'});
    }
    if(facts.length+e.canaryIds.length>20000)fail();
    for(const id of e.canaryIds)facts.push({eventId:e.id,canaryId:id,label:canaries.get(id).label,service:e.service,type:e.type,operation:e.location,path:route,transformations:transforms(id),destination,status:e.status,targetService:m.targetService??null});
  }
  return {schemaVersion:1,traceId,complete,services:[...services].sort(),nodes:{events:ordered(events.values()),canaries:ordered(canaries.values()),destinations:ordered(destinations.values())},edges:ordered(edges),facts:ordered(facts)};
}
