import { createCanaryLineage } from '../../src/sdk/index.js';
process.on('message',async job=>{
  if(job.stop){process.disconnect();return;}
  try{
    await new Promise(resolve=>setTimeout(resolve,10));
    const sdk=createCanaryLineage({serviceName:'worker',distributed:true,failureMode:'strict',allowedOrigins:[new URL(job.url).origin]});
    const result=await sdk.run({synthetic:true,transport:'queue',propagation:job.context,trusted:true,canaries:[{label:'hash',value:job.hash},{label:'customer',value:job.customer}]},async refs=>{
      const response=await sdk.http({url:job.url,targetService:'job-sink',canaries:refs,body:JSON.stringify({hash:refs[0].value}),propagate:false});
      await response.body?.cancel();if(!response.ok)throw new Error('Sink failed');
    });
    process.send({id:job.id,trace:result.trace});
  }catch{process.send({id:job.id,error:'Job rejected'});}
});
