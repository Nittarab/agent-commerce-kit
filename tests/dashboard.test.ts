import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { once,EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { assertReplayOrders } from '../apps/testnet/replay.ts';
import { Ledger } from '../packages/ledger/index.ts';
import { policy,offer,now,success } from './fixtures.ts';
import { snapshot,safeEvent,createDashboard } from '../apps/dashboard/server.ts';
function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'dashboard-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'.local/testnet'),{recursive:true});mkdirSync(join(root,'apps/dashboard/public'),{recursive:true});
 writeFileSync(join(root,'apps/dashboard/public/index.html'),'<meta name="dashboard-token" content="__DASHBOARD_TOKEN__">');
 writeFileSync(join(root,'.local/testnet/accounts.json'),'{"privateKey":"SECRET_TEST_SENTINEL"}');
 const ledger=new Ledger(join(root,'.local/testnet/payer.db'),policy());
 for(const [principal,operationId,amount] of [['researcher','research-report','60'],['reviewer','review-report','30']]){
  const o=ledger.authorize(principal,offer({operationId,amountAtomic:amount}),now).order!;
  ledger.issue(principal,o.id,()=> 'SECRET_SIGNED_PAYLOAD_'+principal,now);ledger.reconcile(success(ledger.submission(o.id,'SIMULATED-'+principal)));ledger.deliver(principal,o.id,'{"simulation":true,"report":"test result"}');
 }
 ledger.close();return root;
}
test('dashboard projects actual settled budgets and results without wallet or signed bytes',t=>{
 const root=fixture(t),s=snapshot(root);assert.equal(s.ready,true);assert.ok('budget' in s);assert.equal(s.budget?.settledAtomic,'90');assert.equal(s.budget?.heldAtomic,'0');assert.equal(s.orders.length,2);
 assert.ok(!JSON.stringify(s).includes('SECRET'));assert.ok(!JSON.stringify(s).includes('payload'));
});
test('missing local data is explicit, and event projection discards secret fields',t=>{
 const root=mkdtempSync(join(tmpdir(),'empty-dashboard-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 assert.equal(snapshot(root).ready,false);
 const event=safeEvent({type:'progress',step:'payment',status:'reused',message:'Saved payment reused.',payload:'SECRET',token:'SECRET',principal:'researcher'});
 assert.ok(event);assert.ok(!JSON.stringify(event).includes('SECRET'));assert.equal(safeEvent({type:'other',message:'bad'}),undefined);
});
test('run endpoint rejects cross-origin/tokenless calls and permits only one replay child',async t=>{
 const root=fixture(t);let launched=0;const child=new EventEmitter() as ChildProcess;
 Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
 const server=createDashboard(root,{launch:()=>{launched++;return child;}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 const page=await (await fetch(base)).text(),token=/content="([a-f0-9]+)"/.exec(page)![1];
 const post=(headers:Record<string,string>)=>fetch(base+'/api/run',{method:'POST',headers,body:'{}'});
 assert.equal((await post({Origin:base})).status,403);
 assert.equal((await post({Origin:'https://attacker.example','X-Dashboard-Token':token})).status,403);
 const hostileStatus=await new Promise<number|undefined>((resolve,reject)=>{const req=request(base+'/api/state',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 assert.equal(hostileStatus,403);
 assert.equal((await fetch(base+'/.local/testnet/accounts.json')).status,404);
 assert.equal((await post({Origin:base,'X-Dashboard-Token':token})).status,202);
 assert.equal((await post({Origin:base,'X-Dashboard-Token':token})).status,409);assert.equal(launched,1);
 (child.stdout as PassThrough).write('ACK_EVENT '+JSON.stringify({type:'progress',message:'Supplier checked.',step:'session',principal:'researcher',payload:'SECRET'})+'\n');
 (child.stdout as PassThrough).write('ACK_EVENT '+JSON.stringify({type:'complete',message:'No new payments.',newIssuances:0,balanceDeltaAtomic:'0'})+'\n');
 child.emit('close',0);
 const state=await (await fetch(base+'/api/state')).json();assert.equal(state.run.status,'succeeded');assert.equal(state.run.summary.newIssuances,0);assert.ok(!JSON.stringify(state).includes('SECRET'));
});
test('exit without structured proof is a visible failure, not a completed replay',async t=>{
 const root=fixture(t);const child=new EventEmitter() as ChildProcess;Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
 const server=createDashboard(root,{launch:()=>child});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port,token=/content="([a-f0-9]+)"/.exec(await (await fetch(base)).text())![1];
 await fetch(base+'/api/run',{method:'POST',headers:{Origin:base,'X-Dashboard-Token':token}});child.emit('close',0);
 const state=await (await fetch(base+'/api/state')).json();assert.equal(state.run.status,'failed');assert.ok(state.run.error);
});
test('failed child blocks retry until close and its late events cannot mutate the next run',async t=>{
 const root=fixture(t);const children=[0,1].map(()=>Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true}) as unknown as ChildProcess);let count=0;
 const server=createDashboard(root,{launch:()=>children[count++]});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port,token=/content="([a-f0-9]+)"/.exec(await(await fetch(base)).text())![1];
 const post=()=>fetch(base+'/api/run',{method:'POST',headers:{Origin:base,'X-Dashboard-Token':token}});
 await post();children[0].emit('error',new Error('failed while stopping'));
 assert.equal((await post()).status,409);children[0].emit('close',1);
 assert.equal((await post()).status,202);assert.equal(count,2);
 (children[0].stdout as PassThrough).write('ACK_EVENT {"type":"progress","message":"old event"}\n');
 const state=await(await fetch(base+'/api/state')).json();assert.equal(state.run.status,'running');assert.equal(state.run.events.length,0);
 children[1].emit('close',1);
});

test('real replay guard refuses absent, unissued, pending or undelivered purchases',t=>{
 const root=fixture(t),ledger=new Ledger(join(root,'.local/testnet/payer.db'),policy());
 try{
  const orders=[ledger.lookup('researcher',offer({operationId:'research-report',amountAtomic:'60'})),ledger.lookup('reviewer',offer({operationId:'review-report',amountAtomic:'30'}))];
  assert.doesNotThrow(()=>assertReplayOrders(orders));
  assert.throws(()=>assertReplayOrders([undefined,orders[1]]),/Replay-only/);
  for(const paymentState of ['reserved','deferred','issued','pending','failed','cancelled'] as const)assert.throws(()=>assertReplayOrders([{...orders[0]!,paymentState},orders[1]]),/Replay-only/);
  assert.throws(()=>assertReplayOrders([{...orders[0]!,deliveryState:'not_delivered'},orders[1]]),/Replay-only/);
  assert.throws(()=>assertReplayOrders([{...orders[0]!,payloadHash:undefined},orders[1]]),/Replay-only/);
  assert.throws(()=>assertReplayOrders([{...orders[0]!,result:undefined},orders[1]]),/Replay-only/);
 }finally{ledger.close();}
});
test('missing ledger blocks the run endpoint before launching a child',async t=>{
 const root=mkdtempSync(join(tmpdir(),'no-purchases-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'apps/dashboard/public'),{recursive:true});writeFileSync(join(root,'apps/dashboard/public/index.html'),'<meta content="__DASHBOARD_TOKEN__">');let launched=0;
 const server=createDashboard(root,{launch:()=>{launched++;throw new Error('Must not launch');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port,token=/content="([a-f0-9]+)"/.exec(await(await fetch(base)).text())![1];
 assert.equal((await fetch(base+'/api/run',{method:'POST',headers:{Origin:base,'X-Dashboard-Token':token}})).status,409);assert.equal(launched,0);
});
