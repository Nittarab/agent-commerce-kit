import assert from 'node:assert/strict';
import { Swarm } from './swarm.ts';
console.log('SIMULATION ONLY — scripted agents, fixture payments and results; no live model, signing, network or chain calls.');
for(const scenario of ['market','budget','uncertain'] as const){
 const swarm=new Swarm();
 try{swarm.start(scenario);for(let n=0;n<80;n++)swarm.step();const s=swarm.snapshot();assert.equal(s.status,'complete');assert.ok(BigInt(s.budget.committed)<=BigInt(s.budget.limit));console.log(JSON.stringify({scenario,requests:s.attempted,delivered:s.delivered,refused:s.refused,retries:s.retries,simulatedIssuances:s.issued,budget:s.budget}));}
 finally{swarm.dispose();}
}
