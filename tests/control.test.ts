import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Ledger } from '../packages/ledger/index.ts';
import { createControlServer } from '../apps/control/server.ts';
import { ControlClient,runAgent } from '../packages/agent/index.ts';
import { policy,offer,now,success } from './fixtures.ts';
async function setup(t:test.TestContext,fault?:'unknown'|'lost_response'){
 const dir=mkdtempSync(join(tmpdir(),'agent-control-'));const ledger=new Ledger(join(dir,'db'),policy());
 const token=randomBytes(32).toString('hex'),reviewerToken=randomBytes(32).toString('hex'),owner=randomBytes(32).toString('hex');
 const server=createControlServer({ledger,tokens:new Map([[token,'researcher'],[reviewerToken,'reviewer']]),ownerToken:owner,now:()=>now,faults:fault?new Map([['operation-1',fault]]):undefined});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {ledger,server,base,token,reviewerToken,owner,client:new ControlClient(base,token),reviewer:new ControlClient(base,reviewerToken)};
}
test('authenticated HTTP purchase, role isolation and no owner-policy escalation',async t=>{
 const {base,token,client,reviewer}=await setup(t);assert.equal((await fetch(base+'/budget')).status,401);
 const result=await client.purchase(offer());assert.equal(result.order?.deliveryState,'delivered');
 assert.equal((await client.budget()).jobCommittedAtomic,'60');
 await assert.rejects(reviewer.recover(result.order!.id),/another principal/);
 const res=await fetch(base+'/owner/stop',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'});assert.equal(res.status,403);
 const forged=await fetch(base+'/purchase',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({offer:offer(),ownerApprovedRevision:true})});assert.equal(forged.status,400);
});
test('lost HTTP response recovers same paid operation with one issuance',async t=>{
 const {client,ledger}=await setup(t,'lost_response');await assert.rejects(client.purchase(offer()));
 const recovered=await client.purchase(offer());assert.equal(recovered.kind,'replay');assert.equal(recovered.order?.deliveryState,'delivered');
 assert.equal(ledger.audit().filter(x=>JSON.parse(x.event).type==='issued').length,1);
 assert.equal((await client.budget()).jobCommittedAtomic,'60');
});
test('unknown simulation retains hold and retry does not sign again',async t=>{
 const {client,ledger}=await setup(t,'unknown');assert.equal((await client.purchase(offer())).order?.paymentState,'pending');
 assert.equal((await client.purchase(offer())).order?.paymentState,'pending');
 assert.equal((await client.budget()).jobCommittedAtomic,'60');assert.equal(ledger.audit().filter(x=>JSON.parse(x.event).type==='issued').length,1);
});
test('bounded runtime rejects forbidden tools and stops non-cooperating model',async()=>{
 await assert.rejects(runAgent({next:async()=>({type:'tool',name:'sign',input:{}})}, {},{maxSteps:2,timeoutMs:1000}),/not allowed/);
 await assert.rejects(runAgent({next:async()=>new Promise(()=>{})},{},{maxSteps:2,timeoutMs:20}),/deadline/);
 await assert.rejects(runAgent({next:async()=>({type:'tool',name:'noop',input:{}})},{noop:async()=>null},{maxSteps:2,timeoutMs:1000}),/step limit/);
});

test('known issued fixture resumes without re-signing; unresolved signer does not strand fresh holds',async t=>{
 const {ledger,client,reviewer}=await setup(t);
 const first=ledger.authorize('researcher',offer(),now).order!;
 ledger.issue('researcher',first.id,()=> new (class {sign(){return 'SIMULATED:resume'}})().sign(),now);
 const recovered=await client.purchase(offer());assert.equal(recovered.order?.deliveryState,'delivered');
 assert.equal(ledger.audit().filter(x=>JSON.parse(x.event).type==='issued').length,1);
 // New isolated pending order holds the shared signer; the next unissued hold is deferred safely.
 const next=ledger.authorize('reviewer',offer({operationId:'unknown-review',amountAtomic:'10'}),now).order!;
 ledger.issue('reviewer',next.id,()=> 'SIMULATED:unresolved',now);ledger.submission(next.id,'SIMULATED-missing-rail');
 const blocked=await client.purchase(offer({operationId:'extra-research',amountAtomic:'5'}));
 assert.equal(blocked.kind,'blocked');assert.equal(blocked.order?.paymentState,'deferred');
 assert.equal((await client.budget()).jobCommittedAtomic,'70');
 await assert.rejects(reviewer.cancel(next.id),/cannot be cancelled/);
 ledger.reconcile(success(ledger.get('reviewer',next.id)));
 const retried=await client.purchase(offer({operationId:'extra-research',amountAtomic:'5'}));
 assert.equal(retried.order?.id,blocked.order?.id);assert.equal(retried.order?.paymentState,'settled');
 assert.equal((await client.budget()).jobCommittedAtomic,'75');
});
test('actor cancellation can release only its own unissued reservation',async t=>{
 const {ledger,client,reviewer}=await setup(t);const reserved=ledger.authorize('researcher',offer(),now).order!;
 await assert.rejects(reviewer.cancel(reserved.id),/another principal/);
 assert.equal((await client.cancel(reserved.id)).order.paymentState,'cancelled');assert.equal((await client.budget()).jobCommittedAtomic,'0');
});
test('aborted client signal prevents sending a purchase',async t=>{
 const {client,ledger}=await setup(t);const controller=new AbortController();controller.abort(new Error('cancelled'));
 await assert.rejects(client.purchase(offer(),controller.signal),/cancelled/);assert.equal(ledger.audit().length,0);
});
