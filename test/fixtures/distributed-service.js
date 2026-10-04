import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { createCanaryLineage, postgresAdapter, postgresTraceStore, PROPAGATION_HEADER } from '../../src/sdk/index.js';

process.once('message',async config=>{
  let pool;
  try {
    if (config.schema && !/^distributed_test_[a-f0-9]{32}$/.test(config.schema)) throw new Error('Invalid schema');
    pool=config.schema ? new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${config.schema}`,connectionTimeoutMillis:3000}) : null;
    const persistent=pool?postgresTraceStore(pool):null;
    const sdk=createCanaryLineage({serviceName:config.name,distributed:true,failureMode:'strict',allowedOrigins:config.target?[new URL(config.target).origin]:[],storage:{
      mode:pool?'postgres':'memory-demo',
      async saveTrace(trace){await persistent?.saveTrace(trace);await new Promise((resolve,reject)=>process.send({segment:trace},error=>error?reject(error):resolve()));},
      async getTrace(){return null;},
    }});
    const server=createServer(async(req,res)=>{
      try {
        let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>8192)throw new Error('Body too large');}
        const data=JSON.parse(body);
        if(config.name==='analytics') {process.send({received:data});res.writeHead(204).end();return;}
        if(config.disabled){
          if(config.name==='users'||data.regression){const reply=await fetch(config.target,{method:'POST',body:JSON.stringify(data)});await reply.body?.cancel();if(!reply.ok)throw new Error('Downstream failed');}
          res.writeHead(200).end('{}');return;
        }
        const {result}=await sdk.run({synthetic:true,propagation:req.headers[PROPAGATION_HEADER],trusted:true,canaries:[{label:'email-sha256',value:data.hash},{label:'customer',value:data.customer}]},refs=>sdk.span('handle',refs,async()=>{
          if(pool){
            const db=postgresAdapter({pool,lineage:sdk});
            await db.query({query:{text:'INSERT INTO distributed_values (value) VALUES ($1) RETURNING value',values:[refs[0].value]},canaries:[refs[0]],table:'distributed_values',column:'value',operation:'INSERT'});
            await db.query({query:{text:'SELECT value FROM distributed_values WHERE value=$1',values:[refs[0].value]},canaries:[refs[0]],table:'distributed_values',column:'value',operation:'SELECT'});
          }
          if(config.name==='users' || data.regression){
            const response=await sdk.http({url:config.target,targetService:config.name==='users'?'processor':'analytics',canaries:refs,body:JSON.stringify(data),propagate:config.name==='users'});
            await response.body?.cancel();if(!response.ok)throw new Error('Downstream failed');
          }
          return {accepted:true};
        }));
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
      }catch {res.writeHead(400).end('Request rejected');}
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    process.send({ready:`http://127.0.0.1:${server.address().port}/receive`});
    process.on('message',message=>{if(message.stop)server.close(async()=>{await pool?.end();process.disconnect();});});
  }catch {process.send({failed:true});await pool?.end();process.exitCode=1;process.disconnect();}
});
