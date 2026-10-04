import { buildGraph } from './graph.js';
const key=value=>JSON.stringify(value);
const sorted=values=>[...values].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
function set(values){return new Map(values.map(value=>[key(value),value]));}
function delta(before,after){const a=set(before),b=set(after);return {added:sorted([...b].filter(([k])=>!a.has(k)).map(([,v])=>v)),removed:sorted([...a].filter(([k])=>!b.has(k)).map(([,v])=>v))};}

export function compareGraphs(baseline,current,{includeStatus=false}={}){
  const before=buildGraph(baseline),after=buildGraph(current);const changes=[];
  function compare(a,b,added,removed){const d=delta(a,b);changes.push(...d.added.map(evidence=>({type:added,evidence})),...d.removed.map(evidence=>({type:removed,evidence})));return d;}
  const sinks=g=>g.facts.filter(f=>f.destination&&f.destination.category!=='database_read');
  compare(sinks(before).map(f=>f.destination),sinks(after).map(f=>f.destination),'NEW_DESTINATION','REMOVED_DESTINATION');
  compare(before.services,after.services,'NEW_SERVICE','REMOVED_SERVICE');
  const paths=g=>g.facts.filter(f=>f.destination).map(f=>({label:f.label,destination:f.destination,path:f.path,...(includeStatus?{status:f.status}:{})}));
  const pathDelta=compare(paths(before),paths(after),'NEW_PATH','REMOVED_PATH');
  for(const added of pathDelta.added)for(const removed of pathDelta.removed)if(added.label===removed.label&&key(added.destination)===key(removed.destination))changes.push({type:'PATH_CHANGED',evidence:{before:removed,after:added}});
  const transforms=g=>g.nodes.canaries.filter(c=>c.operation).map(c=>({label:c.label,operation:c.operation,parents:c.parentCanaryIds.map(id=>g.nodes.canaries.find(p=>p.id===id).label).sort()}));
  const transformations=compare(transforms(before),transforms(after),'TRANSFORMATION_ADDED','TRANSFORMATION_REMOVED');
  for(const added of transformations.added)for(const removed of transformations.removed)if(added.label===removed.label)changes.push({type:'TRANSFORMATION_CHANGED',evidence:{before:removed,after:added}});
  const db=g=>g.facts.filter(f=>f.destination?.category.startsWith('database')).map(f=>({label:f.label,service:f.service,destination:f.destination}));
  const accesses=delta(db(before),db(after));if(accesses.added.length||accesses.removed.length)changes.push({type:'DB_ACCESS_CHANGED',evidence:accesses});
  const hops=g=>g.facts.filter(f=>f.type==='HTTP_OUTPUT').map(f=>({source:f.service,target:f.targetService??f.destination.name}));
  compare(hops(before),hops(after),'NEW_HTTP_HOP','REMOVED_HTTP_HOP');
  const perCanary=g=>sinks(g).map(f=>({label:f.label,destination:f.destination}));const canaries=delta(perCanary(before),perCanary(after));
  if(canaries.added.length||canaries.removed.length)changes.push({type:'CANARY_DESTINATION_CHANGED',evidence:canaries});
  return {schemaVersion:1,baselineTraceId:before.traceId,currentTraceId:after.traceId,complete:before.complete&&after.complete,changes:sorted(changes)};
}
