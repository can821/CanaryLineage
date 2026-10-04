#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { buildGraph } from './analysis/graph.js';
import { compareGraphs } from './analysis/diff.js';
import { evaluatePolicies } from './analysis/policy.js';
import { importBundle, exportBundle } from './analysis/bundle.js';

const args=process.argv.slice(2);const json=args.includes('--json');const debug=args.includes('--debug');
let code=2;
try{
  const flags=new Set(['--json','--debug']);let policyPath;
  const positional=[];
  for(let i=0;i<args.length;i++){
    if(flags.has(args[i]))continue;
    if(args[i]==='--policy'){if(policyPath||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Policy file required');policyPath=args[++i];continue;}
    if(args[i].startsWith('--'))throw new Error('Unknown option');positional.push(args[i]);
  }
  const [command,...files]=positional;
  if(!['inspect','verify','compare','policy','export'].includes(command)||files.length!==(command==='compare'?2:1)||(command==='policy'&&!policyPath)||(policyPath&&!['compare','policy'].includes(command)))throw new Error('Usage: canarylineage inspect|verify|export <trace> | compare <baseline> <current> [--policy file] | policy <trace> --policy file [--json]');
  async function read(path){
    const file=await open(path,'r');try{
      const stat=await file.stat();if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('Input must be a regular JSON file <= 2 MiB');
      const buffer=Buffer.alloc(2*1024*1024+1);let total=0;
      while(total<buffer.length){const {bytesRead}=await file.read(buffer,total,buffer.length-total,null);if(!bytesRead)break;total+=bytesRead;}
      if(total>2*1024*1024)throw new Error('Input exceeds limit');
      return JSON.parse(buffer.subarray(0,total).toString('utf8'));
    }finally{await file.close();}
  }
  code=3;
  const documents=[];for(const path of files){const input=await read(path);const traces=input?.checksum!==undefined?importBundle(input):input;buildGraph(traces);documents.push(traces);}
  let config;if(policyPath){code=2;config=await read(policyPath);}
  let output;
  if(command==='compare')output={diff:compareGraphs(documents[0],documents[1]),...(config?{policy:evaluatePolicies(documents[1],config,{baseline:documents[0]})}:{})};
  if(command==='policy')output={policy:evaluatePolicies(documents[0],config)};
  if(command==='inspect')output=buildGraph(documents[0]);
  if(command==='verify')output={valid:true,complete:buildGraph(documents[0]).complete};
  if(command==='export')output=exportBundle(documents[0]);
  code=4;
  if(json||command==='export')console.log(JSON.stringify(output,null,2));
  else if(output.diff){console.log(`Lineage comparison: ${output.diff.changes.length} semantic changes`);for(const c of output.diff.changes)console.log(`${c.type}: ${JSON.stringify(c.evidence)}`);}
  else if(!output.policy)console.log(command==='verify'?`VALID — evidence ${output.complete?'complete':'incomplete'}`:`Trace ${output.traceId}: ${output.services.join(' → ')}; ${output.nodes.events.length} events; ${output.complete?'complete':'incomplete'}`);
  if(output.policy&&!json){console.log(`Policy: ${output.policy.status}`);for(const r of output.policy.results){console.log(`${r.status} ${r.ruleId}: ${r.explanation}`);if(r.evidence.length)console.log(JSON.stringify(r.evidence));}}
  process.exitCode=output.policy?.status==='FAIL'?1:0;
}catch(error){
  if(json)console.error(JSON.stringify({error:code===3?'Invalid trace or unreadable trace file':code===2?'Invalid command or policy configuration':'Internal failure',exitCode:code}));
  else console.error(code===3?'Invalid trace or unreadable trace file':code===2?'Invalid command or policy configuration. See docs/DISTRIBUTED.md.':'Internal failure');
  if(debug)console.error(error.stack);
  process.exitCode=code;
}
