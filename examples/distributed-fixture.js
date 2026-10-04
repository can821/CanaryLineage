import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createCanaryLineage, postgresTraceStore } from '../src/sdk/index.js';

/** Three separately executing Node services; all traffic is real localhost HTTP. */
export async function startDistributed({ schema, pool, disabled = false } = {}) {
  const segments=[];const received=[];const children=[];
  async function close(){
    await Promise.all(children.map(child=>new Promise(resolve=>{
      if(child.exitCode!==null)return resolve();
      const timeout=setTimeout(()=>child.kill('SIGKILL'),2000);
      child.once('exit',()=>{clearTimeout(timeout);resolve();});
      if(child.connected)child.send({stop:true});else child.kill();
    })));
  }
  async function start(config){
    const child=fork(new URL('../test/fixtures/distributed-service.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc']});
    children.push(child);
    return new Promise((resolve,reject)=>{
      let ready=false;
      const timeout=setTimeout(()=>reject(new Error('Service startup timeout')),5000);
      child.on('message',message=>{
        if(message.segment)segments.push(message.segment);
        if(message.received)received.push(message.received);
        if(message.ready){ready=true;clearTimeout(timeout);resolve(message.ready);}
        if(message.failed){clearTimeout(timeout);reject(new Error('Service startup failed'));}
      });
      child.on('error',()=>{clearTimeout(timeout);reject(new Error('Service process error'));});
      child.on('exit',()=>{if(!ready){clearTimeout(timeout);reject(new Error('Service exited'));}});
      child.send(config);
    });
  }
  try {
    const sink=await start({name:'analytics'});
    const processor=await start({name:'processor',target:sink,disabled});
    const users=await start({name:'users',target:processor,schema,disabled});
    const persistent=pool?postgresTraceStore(pool):null;
    const sdk=createCanaryLineage({serviceName:'gateway',distributed:true,failureMode:'strict',allowedOrigins:[new URL(users).origin],storage:{mode:pool?'postgres':'memory-demo',async saveTrace(t){segments.push(t);await persistent?.saveTrace(t);},async getTrace(){return null;}}});
    return { received, close, async run({regression=false,suffix='one'}={}){
      if(disabled){
        const hash=createHash('sha256').update(`canary-${suffix}@example.test`.toLowerCase()).digest('hex');
        const response=await fetch(users,{method:'POST',body:JSON.stringify({hash,customer:`synthetic-${suffix}`,regression})});
        await response.body?.cancel();if(!response.ok)throw new Error('Uninstrumented request failed');return [];
      }
      const result=await sdk.run({synthetic:true,canaries:[{label:'email',value:`canary-${suffix}@example.test`},{label:'customer',value:`synthetic-${suffix}`}]},([email,customer])=>sdk.span('signup',[email,customer],async()=>{
        const lower=sdk.derive({parents:[email],label:'email-lower',value:email.value.toLowerCase(),operation:'lowercase'});
        const hash=sdk.derive({parents:[lower],label:'email-sha256',value:createHash('sha256').update(lower.value).digest('hex'),operation:'sha256'});
        const response=await sdk.http({url:users,targetService:'users',canaries:[hash,customer],body:JSON.stringify({hash:hash.value,customer:customer.value,regression})});
        await response.body?.cancel();if(!response.ok)throw new Error('Distributed request failed');
      }));
      for(let i=0;i<100&&segments.filter(s=>s.id===result.trace.id).length<3;i++)await delay(5);
      const selected=segments.filter(s=>s.id===result.trace.id);
      if(selected.length!==3)throw new Error('Missing service segments');
      return selected;
    }};
  }catch(error){await close();throw error;}
}
