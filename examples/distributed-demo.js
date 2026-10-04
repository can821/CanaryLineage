import { mkdir, writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { startDistributed } from './distributed-fixture.js';
import { exportBundle } from '../src/analysis/bundle.js';
import { compareGraphs } from '../src/analysis/diff.js';
import { evaluatePolicies } from '../src/analysis/policy.js';
const directory=resolve(process.argv[2]??'.local/distributed-demo');
const fixture=await startDistributed();
const shutdown=()=>{fixture.close().finally(()=>process.exit(130));};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
  const baseline=await fixture.run({suffix:'baseline'});const current=await fixture.run({regression:true,suffix:'current'});
  const config={schemaVersion:1,rules:[{id:'no-new-destinations',type:'NO_NEW_DESTINATIONS'},{id:'no-analytics',type:'DENY_DESTINATIONS',destinations:['analytics']}]};
  const pass=evaluatePolicies(baseline,config,{baseline});const fail=evaluatePolicies(current,config,{baseline});
  if(pass.status!=='PASS'||fail.status!=='FAIL')throw new Error('Regression demonstration failed');
  await mkdir(directory,{recursive:true});
  for(const [name,value] of Object.entries({'baseline.json':exportBundle(baseline),'current.json':exportBundle(current),'policy.json':config,'diff.json':compareGraphs(baseline,current)}))await writeFile(join(directory,name),JSON.stringify(value,null,2));
  console.log(`Real local HTTP demo: gateway → users → processor → analytics (regression only).\nStorage in this standalone demo: memory only; PostgreSQL path is integration-tested separately.\nBaseline policy: ${pass.status}; regression policy: ${fail.status}.\nArtifacts: ${directory}`);
}finally{await fixture.close();}
