// After-the-fact adapter. Upstream JSON Server source is loaded unchanged.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fork, execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanaryLineage, PROPAGATION_HEADER } from '../../src/sdk/index.js';
import { exportBundle } from '../../src/analysis/bundle.js';
import { compareGraphs } from '../../src/analysis/diff.js';
import { evaluatePolicies } from '../../src/analysis/policy.js';
const pin='78ea71375666d49145734689c097654c54f90686';
const here=fileURLToPath(import.meta.url);
if(process.argv[2]==='--receiver'){
  const sdk=createCanaryLineage({serviceName:'archive',distributed:true,failureMode:'strict'});
  const server=createServer(async(req,res)=>{
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('limit');}
      const value=JSON.parse(body);
      const result=await sdk.run({synthetic:true,trusted:true,propagation:req.headers[PROPAGATION_HEADER],canaries:[{label:'email-sha256',value:value.hash}]},refs=>sdk.span('archive.accept',refs,()=>value.hash));
      process.send({segment:result.trace},()=>res.end('accepted'));
    }catch{res.statusCode=500;res.end('failed');}
  });
  server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
  process.on('message',()=>server.close(()=>process.exit()));
}else{
  const root=resolve(process.argv[2]??'');
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),pin,'Use the documented pinned upstream commit');
  assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','src'],{cwd:root,encoding:'utf8'}).trim(),'','Upstream source must be unchanged');
  const require=createRequire(join(root,'package.json'));
  const jsonServer=require(join(root,'src/server/index.js'));
  const directory=resolve(process.argv[3]??'.local/external-validation');await mkdir(directory,{recursive:true});
  const temp=await mkdtemp(join(tmpdir(),'canary-external-'));const dbPath=join(temp,'db.json');
  await writeFile(dbPath,JSON.stringify({users:[]}));
  const child=fork(here,['--receiver'],{stdio:['ignore','ignore','inherit','ipc']});
  const segments=[];child.on('message',m=>{if(m.segment)segments.push(m.segment);});
  const ready=await Promise.race([once(child,'message'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('worker timeout')),5000);t.unref();})]);
  const archive=`http://127.0.0.1:${ready[0].port}`;
  const sink=createServer((req,res)=>{req.resume();res.end('ok');});sink.listen(0,'127.0.0.1');await once(sink,'listening');
  const analytics=`http://127.0.0.1:${sink.address().port}`;
  const sdk=createCanaryLineage({serviceName:'json-server',distributed:true,failureMode:'strict',allowedOrigins:[archive,analytics]});
  const app=jsonServer.create();app.use(jsonServer.bodyParser);
  const router=jsonServer.router(dbPath);const finished=[];
  // Public middleware + render hooks only. CRUD/write implementation stays upstream.
  app.use((req,res,next)=>{
    sdk.run({synthetic:true,canaries:[{label:'email',value:req.body.email}]},refs=>sdk.span('json-server.createUser',refs,async()=>{
      sdk.observe({type:'HTTP_INPUT',location:'POST /users',canaries:refs});
      const hash=createHash('sha256').update(refs[0].value.toLowerCase()).digest('hex');
      const derived=sdk.derive({parents:refs,label:'email-sha256',value:hash,operation:'lowercase-sha256'});
      req.body={emailHash:hash};
      const written=await new Promise((resolve,reject)=>{res.locals.done=resolve;res.locals.reject=reject;next();});
      const saved=JSON.parse(await readFile(dbPath,'utf8')).users;
      assert(saved.some(row=>row.id===written.id&&row.emailHash===hash));
      sdk.observe({type:'FUNCTION',location:'lowdb.file.persisted',canaries:[derived],status:'success'});
      assert.equal((await sdk.http({url:archive+'/archive',targetService:'archive',canaries:[derived],body:JSON.stringify({hash})})).status,200);
      if(req.headers['x-test-regression']==='true')assert.equal((await sdk.http({url:analytics+'/collect',targetService:'analytics',canaries:[derived],body:JSON.stringify({hash}),propagate:false})).status,200);
      return written;
    })).then(result=>{finished.push(result.trace);res.status(201).json(result.result);},()=>res.status(500).json({error:'validation failed'}));
  });
  router.render=(_req,res)=>res.locals.done(res.locals.data);app.use(router);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const runs=[];
    for(const regression of [false,true]){
      const response=await fetch(`http://127.0.0.1:${server.address().port}/users`,{method:'POST',headers:{'content-type':'application/json','x-test-regression':String(regression)},body:JSON.stringify({email:`CANARY_${regression}@example.invalid`})});
      assert.equal(response.status,201);await response.json();
      const trace=finished.at(-1);runs.push([trace,...segments.filter(s=>s.id===trace.id)]);assert.equal(runs.at(-1).length,2);
    }
    const policy={schemaVersion:1,rules:[{id:'no-new',type:'NO_NEW_DESTINATIONS'},{id:'deny-analytics',type:'DENY_DESTINATIONS',destinations:['analytics']}]};
    const pass=evaluatePolicies(runs[0],policy,{baseline:runs[0]}),fail=evaluatePolicies(runs[1],policy,{baseline:runs[0]});
    assert.equal(pass.status,'PASS');assert.equal(fail.status,'FAIL');
    const diff=compareGraphs(...runs);assert(diff.changes.some(c=>c.type==='NEW_PATH'));assert(diff.changes.some(c=>c.type==='NEW_DESTINATION'));
    for(const [name,value] of Object.entries({'baseline.json':exportBundle(runs[0]),'current.json':exportBundle(runs[1]),'policy.json':policy,'diff.json':diff}))await writeFile(join(directory,name),JSON.stringify(value,null,2));
    for(const [name,code] of [['baseline',0],['current',1]]){
      const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../../src/cli.js',import.meta.url)),'compare',join(directory,'baseline.json'),join(directory,`${name}.json`),'--policy',join(directory,'policy.json'),'--json'],{encoding:'utf8'});assert.equal(cli.status,code,cli.stderr);
    }
    const report={upstream:'https://github.com/typicode/json-server',commit:pin,node:process.version,storage:'real lowdb JSON file (not PostgreSQL)',upstreamSourceChanges:0,baseline:'PASS',regression:'FAIL',cliExitCodes:[0,1],segmentsPerRun:2,flow:'HTTP → JSON Server middleware → explicit hash → upstream CRUD/file write → archive process; regression → analytics',limitations:'Adapter adds transformation/outbound behavior; upstream is an independent prototyping REST server, not a production customer deployment.'};
    await writeFile(join(directory,'validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{
    server.closeAllConnections();sink.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>sink.close(r))]);child.send('stop');const timer=setTimeout(()=>child.kill(),2000);await once(child,'exit');clearTimeout(timer);await rm(temp,{recursive:true,force:true});
  }
}
