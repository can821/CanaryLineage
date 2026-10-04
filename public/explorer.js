const $=id=>document.getElementById(id);
let analysis;
const add=(parent,tag,text,className='')=>{const node=document.createElement(tag);node.textContent=text;node.className=className;parent.append(node);return node;};
async function file(id){const f=$(id).files[0];if(!f)return undefined;if(f.size>2*1024*1024)throw Error('Each file must be <= 2 MiB.');return JSON.parse(await f.text());}
function options(id,items,label){$(id).replaceChildren();const all=add($(id),'option',label);all.value='';for(const [value,text] of items){const option=add($(id),'option',text);option.value=value;}}
function render(){
  if(!analysis)return;
  const {graph,diff,policy}=analysis;
  const facts=graph.facts.filter(f=>(!$('canary').value||f.canaryId===$('canary').value)&&(!$('service').value||f.service===$('service').value)&&(!$('destination').value||f.destination?.name===$('destination').value));
  const ids=new Set(facts.map(f=>f.eventId));
  $('services').replaceChildren();for(const service of new Set(facts.map(f=>f.service)))add($('services'),'div',service,'card');
  $('hops').replaceChildren();const seen=new Set();for(const f of facts.filter(f=>f.destination)){
    const key=JSON.stringify([f.service,f.destination]);if(seen.has(key))continue;seen.add(key);
    const fresh=diff?.changes.some(c=>c.type==='NEW_DESTINATION'&&JSON.stringify(c.evidence)===JSON.stringify(f.destination));
    add($('hops'),'div',`${f.service} → ${f.destination.name} · ${f.type}${fresh?' · NEW DESTINATION':''}`,'hop'+(fresh?' new':''));
  }
  $('verdict').replaceChildren();add($('verdict'),'strong',policy?.status??'No policy supplied',policy?.status??'');
  for(const result of policy?.results??[]){const detail=add($('verdict'),'details','');add(detail,'summary',`${result.status} · ${result.ruleId}`);add(detail,'pre',JSON.stringify(result,null,2));}
  $('changes').replaceChildren();for(const change of diff?.changes??[]){const d=add($('changes'),'details','',change.type.startsWith('NEW_')?'new':'');add(d,'summary',change.type);add(d,'pre',JSON.stringify(change.evidence,null,2));}
  if(!diff)add($('changes'),'p','No baseline supplied.');else if(!diff.changes.length)add($('changes'),'p','No semantic changes.');
  $('timeline').replaceChildren();for(const event of graph.nodes.events.filter(e=>ids.has(e.id)).sort((a,b)=>(a.occurredAt??'').localeCompare(b.occurredAt??'')||(a.sequence??0)-(b.sequence??0))){
    const eventFacts=facts.filter(f=>f.eventId===event.id);
    const fresh=diff?.changes.some(c=>c.type==='NEW_PATH'&&eventFacts.some(f=>f.label===c.evidence.label&&JSON.stringify(f.path)===JSON.stringify(c.evidence.path)&&JSON.stringify(f.destination)===JSON.stringify(c.evidence.destination)));
    const button=add($('timeline'),'button',`${event.occurredAt??'Time unavailable'} · ${event.service} · ${event.type} · ${event.location} · ${event.status}${fresh?' · NEW PATH':''}`,'event'+(fresh?' new':''));
    button.addEventListener('click',()=>{$('details').textContent=JSON.stringify({event,evidence:eventFacts},null,2);});
  }
}
$('analyze').addEventListener('click',async()=>{
  try{
    const [current,baseline,policy]=await Promise.all(['current','baseline','policy'].map(file));if(!current)throw Error('Choose a current trace or bundle.');
    const response=await fetch('/api/explorer/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current,baseline,policy})});
    if(!response.ok)throw Error('Invalid or oversized trace, bundle or policy.');analysis=await response.json();
    const {graph}=analysis;$('status').textContent=`${graph.traceId} · ${graph.complete?'COMPLETE supplied evidence':'INCOMPLETE evidence — no passing policy conclusion'} · ${graph.nodes.events.length} events · ${graph.evidence?.state??'trust not reported'}`;
    $('status').className=graph.complete?'':'warning';
    options('canary',graph.nodes.canaries.map(c=>[c.id,`${c.label} · ${c.id.slice(0,8)}`]),'All canaries');options('service',graph.services.map(s=>[s,s]),'All services');options('destination',[...new Set(graph.nodes.destinations.map(d=>d.name))].map(s=>[s,s]),'All destinations');$('details').textContent='Select an event.';render();
  }catch(error){analysis=null;$('status').textContent=error.message;for(const id of ['services','hops','verdict','changes','timeline','details'])$(id).replaceChildren();}
});
for(const id of ['canary','service','destination'])$(id).addEventListener('change',render);
