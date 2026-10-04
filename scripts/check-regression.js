import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base='.local/distributed-demo/';
for(const [file,status,exit] of [['baseline.json','PASS',0],['current.json','FAIL',1]]){
  const result=spawnSync(process.execPath,['src/cli.js','compare',`${base}baseline.json`,`${base}${file}`,'--policy',`${base}policy.json`,'--json'],{encoding:'utf8'});
  assert.equal(result.status,exit,result.stderr);
  assert.equal(JSON.parse(result.stdout).policy.status,status);
  console.log(`${file}: ${status}, expected exit ${exit} verified`);
}
