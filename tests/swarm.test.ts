import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Swarm } from '../apps/dashboard/swarm.ts';
import { createDashboard } from '../apps/dashboard/server.ts';

for(const scenario of ['market','budget','uncertain'] as const){
 test('swarm '+scenario+' uses real reservations without overspending or double issuance',()=>{
  const swarm=new Swarm();
  try{
   swarm.start(scenario);
   for(let n=0;n<80;n++){
    swarm.step();const s=swarm.snapshot();
    assert.equal(s.simulation,true);assert.ok(BigInt(s.budget.committed)<=BigInt(s.budget.limit));
    assert.equal(BigInt(s.budget.paid)+BigInt(s.budget.held),BigInt(s.budget.committed));
    for(const agent of s.agents){const spent=s.orders.filter(o=>o.agent===agent.id).reduce((sum,o)=>sum+BigInt(o.amount),0n);assert.ok(spent<=40n);}
   }
   const s=swarm.snapshot();assert.equal(s.status,'complete');assert.equal(s.attempted,48);assert.ok(s.delivered>0);assert.ok(s.refused>0);
   if(scenario==='uncertain'){
    assert.ok(BigInt(s.budget.held)>0);assert.equal(s.orders.filter(o=>o.payment==='pending').length,1);
    assert.equal(s.issued,s.delivered+1);assert.ok(s.events.some(e=>e.stage==='held'));
   }else{assert.equal(s.budget.held,'0');assert.equal(s.issued,s.delivered);assert.ok(s.retries>0);}
   assert.equal(s.events.filter(e=>e.stage==='refused').length,s.refused);
   assert.equal(s.orders.filter(o=>o.delivery==='delivered').length,s.delivered);
  }finally{swarm.dispose();}
 });
}
test('pause freezes active work and preserves reservations; starting again cannot reset an active budget',()=>{
 const swarm=new Swarm();try{
  swarm.start('uncertain');for(let i=0;i<15;i++)swarm.step();swarm.pause();const before=swarm.snapshot();
  for(let i=0;i<50;i++)swarm.step();assert.deepEqual(swarm.snapshot(),before);
  assert.throws(()=>swarm.start('market'));swarm.resume();swarm.step();assert.equal(swarm.snapshot().tick,before.tick+1);
  assert.throws(()=>swarm.setSpeed(100));
 }finally{swarm.dispose();}
});
test('a new simulated scenario retains the previous uncertain ledger on disk',()=>{
 const dir=mkdtempSync(join(tmpdir(),'swarm-test-'));const swarm=new Swarm(dir);
 try{
  swarm.start('uncertain');for(let n=0;n<80;n++)swarm.step();const old=swarm.snapshot();swarm.start('market');
  assert.notEqual(swarm.snapshot().runId,old.runId);
  const db=new DatabaseSync(join(dir,old.runId+'.db'),{readOnly:true});
  try{assert.equal((db.prepare("SELECT COUNT(*) AS count FROM orders WHERE payment='pending'").get() as {count:number}).count,1);}finally{db.close();}
 }finally{swarm.dispose();rmSync(dir,{recursive:true,force:true});}
});
test('swarm mutation routes reject missing token and cross-origin requests',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'swarm-http-')),server=createDashboard(dir);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address() as {port:number},base='http://127.0.0.1:'+address.port;
 try{
  const initial=await (await fetch(base+'/api/swarm')).json();assert.equal(initial.status,'idle');assert.equal(initial.simulation,true);
  for(const origin of [base,'https://attacker.example'])assert.equal((await fetch(base+'/api/swarm/start/market',{method:'POST',headers:{origin}})).status,403);
  assert.equal((await (await fetch(base+'/api/swarm')).json()).status,'idle');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
});
