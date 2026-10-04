import express from 'express';
import { buildGraph, compareGraphs, evaluatePolicies, importBundle } from './analysis/index.js';
export function explorerRouter(){
  const router=express.Router();
  router.post('/analyze',express.json({limit:'2mb'}),(req,res)=>{
    try{
      const decode=value=>value?.checksum!==undefined?importBundle(value):value;
      const current=decode(req.body.current),baseline=req.body.baseline?decode(req.body.baseline):undefined;
      const graph=buildGraph(current);
      res.json({graph,diff:baseline?compareGraphs(baseline,current):null,policy:req.body.policy?evaluatePolicies(current,req.body.policy,{baseline}):null});
    }catch{res.status(400).json({error:'Invalid trace, bundle or policy; no evidence accepted.'});}
  });
  return router;
}
