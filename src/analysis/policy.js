import { buildGraph } from './graph.js';
import { compareGraphs } from './diff.js';
const names=['DENY_UNTRUSTED_PROPAGATION','DENY_DESTINATIONS','ALLOW_DESTINATIONS','NO_NEW_DESTINATIONS','DENY_NEW_PATHS','WARN_ON_NEW_SERVICE','REQUIRE_TRANSFORMATION','MAX_SERVICE_HOPS','DENY_CANARY_DESTINATIONS'];
export function evaluatePolicies(current,config,{baseline}={}){
  if(!config||config.schemaVersion!==1||!Array.isArray(config.rules)||config.rules.length>100||Object.keys(config).some(k=>!['schemaVersion','rules'].includes(k)))throw new Error('Invalid policy configuration');
  const ids=new Set();
  for(const rule of config.rules){
    if(!rule||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(rule.id)||ids.has(rule.id)||!names.includes(rule.type)||!['fail','warn',undefined].includes(rule.severity)||Object.keys(rule).some(k=>!['id','type','severity','destinations','label','operation','max'].includes(k)))throw new Error('Invalid policy rule');
    const fields={DENY_UNTRUSTED_PROPAGATION:[],DENY_DESTINATIONS:['destinations','label'],ALLOW_DESTINATIONS:['destinations','label'],NO_NEW_DESTINATIONS:[],DENY_NEW_PATHS:[],WARN_ON_NEW_SERVICE:[],REQUIRE_TRANSFORMATION:['operation','label'],MAX_SERVICE_HOPS:['max','label'],DENY_CANARY_DESTINATIONS:['destinations','label']}[rule.type];
    if(Object.keys(rule).some(k=>!['id','type','severity',...fields].includes(k)))throw new Error('Unsupported field for policy rule');
    ids.add(rule.id);
    if(rule.label!==undefined&&(typeof rule.label!=='string'||rule.label.length>128))throw new Error('Invalid canary label');
    if(['DENY_DESTINATIONS','ALLOW_DESTINATIONS','DENY_CANARY_DESTINATIONS'].includes(rule.type)&&(!Array.isArray(rule.destinations)||rule.destinations.length>100||rule.destinations.some(d=>typeof d!=='string'||!d||d.length>256)))throw new Error('Destination list required');
    if(rule.type==='DENY_CANARY_DESTINATIONS'&&!rule.label)throw new Error('Canary label required');
    if(rule.type==='REQUIRE_TRANSFORMATION'&&(typeof rule.operation!=='string'||!rule.operation||rule.operation.length>128))throw new Error('Transformation required');
    if(rule.type==='MAX_SERVICE_HOPS'&&(!Number.isSafeInteger(rule.max)||rule.max<0||rule.max>128))throw new Error('Invalid hop limit');
    if(['NO_NEW_DESTINATIONS','DENY_NEW_PATHS','WARN_ON_NEW_SERVICE'].includes(rule.type)&&!baseline)throw new Error('Baseline required by policy');
  }
  const graph=buildGraph(current);const diff=baseline?compareGraphs(baseline,current):null;
  const results=[];
  if(!graph.complete||diff?.complete===false)results.push({ruleId:'incomplete-evidence',severity:'fail',status:'FAIL',traceId:graph.traceId,explanation:'Missing or truncated evidence cannot produce a passing policy verdict.',evidence:[]});
  for(const rule of config.rules){
    const sinks=graph.facts.filter(f=>f.destination&&f.destination.category!=='database_read'&&(!rule.label||f.label===rule.label));let evidence=[];
    if(rule.type==='DENY_DESTINATIONS'||rule.type==='DENY_CANARY_DESTINATIONS')evidence=sinks.filter(f=>rule.destinations.includes(f.destination.name));
    if(rule.type==='ALLOW_DESTINATIONS')evidence=sinks.filter(f=>!rule.destinations.includes(f.destination.name));
    if(rule.type==='REQUIRE_TRANSFORMATION')evidence=sinks.filter(f=>f.destination.category==='http'&&!f.transformations.includes(rule.operation));
    if(rule.type==='MAX_SERVICE_HOPS')evidence=sinks.filter(f=>f.path.reduce((n,p,i,a)=>n+(i>0&&p.service!==a[i-1].service?1:0),0)>rule.max);
    if(rule.type==='DENY_UNTRUSTED_PROPAGATION'&&graph.evidence.trust.some(t=>['unsigned','rejected','unknown'].includes(t)))evidence=[{traceId:graph.traceId,...graph.evidence,events:graph.nodes.events.filter(e=>['HTTP_INPUT','QUEUE_CONSUMER'].includes(e.type))}];
    const category={NO_NEW_DESTINATIONS:'NEW_DESTINATION',DENY_NEW_PATHS:'NEW_PATH',WARN_ON_NEW_SERVICE:'NEW_SERVICE'}[rule.type];
    if(category)evidence=diff.changes.filter(c=>c.type===category).map(c=>({change:c.evidence,observations:graph.facts.filter(f=>category==='NEW_DESTINATION'?JSON.stringify(f.destination)===JSON.stringify(c.evidence):category==='NEW_SERVICE'?f.service===c.evidence:f.label===c.evidence.label&&JSON.stringify(f.path)===JSON.stringify(c.evidence.path))}));
    const severity=rule.severity??(rule.type==='WARN_ON_NEW_SERVICE'?'warn':'fail');
    results.push({ruleId:rule.id,severity,status:evidence.length?(severity==='warn'?'WARN':'FAIL'):'PASS',traceId:graph.traceId,explanation:evidence.length?'Rule matched observed lineage evidence.':'No matching violation observed.',evidence});
  }
  return {schemaVersion:1,evidence:graph.evidence,status:results.some(r=>r.status==='FAIL')?'FAIL':results.some(r=>r.status==='WARN')?'WARN':'PASS',results};
}
