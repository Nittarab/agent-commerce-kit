import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Ledger } from '../packages/ledger/index.ts';
import { sha256 } from '../packages/core/index.ts';
import { policy,offer,now,success } from './fixtures.ts';
function setup(t: test.TestContext) { const dir=mkdtempSync(join(tmpdir(),'agent-kit-'));const path=join(dir,'ledger.db');const ledger=new Ledger(path,policy());t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});return {ledger,path}; }
test('reserve, pay, immutable delivery, replay and own-principal access',t=>{
 const {ledger}=setup(t);const auth=ledger.authorize('researcher',offer(),now);assert.equal(auth.kind,'authorized');const id=auth.order!.id;
 assert.equal(ledger.authorize('researcher',offer(),now).order!.id,id);let calls=0;
 const issued=ledger.issue('researcher',id,()=>{calls++;return 'SIMULATED-1';},now);
 ledger.issue('researcher',id,()=>{calls++;return 'wrong';},now);assert.equal(calls,1);
 assert.throws(()=>ledger.get('reviewer',id),/another principal/);
 const pending=ledger.submission(id,'SIMULATED-TX-1');assert.equal(pending.paymentState,'pending');
 assert.throws(()=>ledger.deliver('researcher',id,'data'),/not settled/);
 const evidence=success(pending);assert.throws(()=>ledger.reconcile({...evidence,payTo:'attacker.testnet'}),/terms mismatch/);
 ledger.reconcile(evidence);ledger.reconcile(evidence);ledger.deliver('researcher',id,'data');
 assert.equal(ledger.get('researcher',id).result!.digest,sha256('data'));
 assert.throws(()=>ledger.deliver('researcher',id,'other'),/immutable/);
 assert.equal(ledger.budget('researcher').jobCommittedAtomic,'60');
 let previous='0'.repeat(64);for(const e of ledger.audit()){assert.equal(e.previous_hash,previous);assert.equal(e.hash,sha256(previous+e.event));previous=e.hash;}
 assert.ok(!JSON.stringify(ledger.get('researcher',id)).includes(issued.payload));
});
test('shared cap across connections; forged principal and terms never authorize',t=>{
 const {ledger,path}=setup(t);const second=new Ledger(path,policy());t.after(()=>second.close());
 assert.equal(ledger.authorize('researcher',offer({amountAtomic:'70'}),now).kind,'authorized');
 assert.equal(second.authorize('reviewer',offer({operationId:'other',amountAtomic:'40'}),now).kind,'denied');
 assert.equal(ledger.authorize('unknown',offer(),now).kind,'denied');
 assert.equal(ledger.authorize('researcher',offer({amountAtomic:'61'}),now).decision.code,'terms_mutated');
 assert.equal(second.budget('reviewer').jobCommittedAtomic,'70');
});
test('unknown after restart keeps hold; expiry alone cannot release or reissue',t=>{
 const {ledger,path}=setup(t);const id=ledger.authorize('researcher',offer(),now).order!.id;
 ledger.issue('researcher',id,()=> 'SIMULATED-uncertain',now);const pending=ledger.submission(id,'SIMULATED-unknown');
 const second=new Ledger(path,policy());t.after(()=>second.close());
 const e=success(pending);second.reconcile({...e,final:false,outcome:'unknown'});
 assert.equal(second.budget('researcher').jobCommittedAtomic,'60');
 second.reconcile({...e,outcome:'failure',noFurtherExecution:false});assert.equal(second.get('researcher',id).paymentState,'pending');
 assert.throws(()=>second.cancel('researcher',id),/cannot be cancelled/);
 const other=second.authorize('reviewer',offer({operationId:'check',amountAtomic:'30'}),now).order!;
 assert.throws(()=>second.issue('reviewer',other.id,()=> 'different',now),/unresolved attempt/);
 assert.equal(second.issue('researcher',id,()=>{throw Error('must not re-sign');},now).payload,'SIMULATED-uncertain');
 second.reconcile({...e,outcome:'failure',noFurtherExecution:true});assert.equal(second.budget('researcher').jobCommittedAtomic,'30');
 assert.throws(()=>second.reconcile(e),/Contradictory/);
});
test('revision needs owner; same revision immutable even after replacement; settled cannot recharge',t=>{
 const {ledger}=setup(t);const a=offer();const first=ledger.authorize('researcher',a,now).order!;
 const revised=offer({revision:'2',amountAtomic:'65'});
 assert.equal(ledger.authorize('researcher',revised,now).kind,'awaiting_approval');
 const next=ledger.authorize('researcher',revised,now,{expectedOrderId:first.id,expectedRevision:'1'}).order!;assert.equal(ledger.get('researcher',first.id).paymentState,'cancelled');
 assert.equal(ledger.budget('researcher').jobCommittedAtomic,'65');
 assert.equal(ledger.authorize('researcher',offer({amountAtomic:'61'}),now,{expectedOrderId:next.id,expectedRevision:'2'}).decision.code,'terms_mutated');
 ledger.issue('researcher',next.id,()=> 'SIMULATED-v2',now);const p=ledger.submission(next.id,'SIMULATED-v2-tx');ledger.reconcile(success(p));
 assert.equal(ledger.authorize('researcher',offer({revision:'3'}),now,{expectedOrderId:next.id,expectedRevision:'2'}).decision.code,'operation_locked');
});
test('stop and expired grants block issuance; cancelled holds release; policy cannot mutate in place',t=>{
 const {ledger,path}=setup(t);const a=ledger.authorize('researcher',offer(),now).order!;
 assert.throws(()=>ledger.issue('researcher',a.id,()=> 'bad',new Date('2031-01-01T00:00:00Z')));
 ledger.stop();assert.throws(()=>ledger.issue('researcher',a.id,()=> 'bad',now),/stopped/);
 ledger.cancel('researcher',a.id);assert.equal(ledger.budget('researcher').jobCommittedAtomic,'0');
 const copy=ledger.policy;copy.jobBudgetAtomic='999';assert.equal(ledger.policy.jobBudgetAtomic,'100');
 assert.throws(()=>new Ledger(path,copy),/pinned/);
});
test('two real processes race for 70 + 40 against one 100 budget',async t=>{
 const {ledger,path}=setup(t);
 const child=new URL('./race-worker.ts',import.meta.url);
 function run(principal:string,amount:string){return new Promise<string>((resolve,reject)=>{
  const p=spawn(process.execPath,[fileURLToPath(child),path,principal,amount],{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('exit',code=>code===0?resolve(out.trim()):reject(new Error(err)));
 });}
 const results=await Promise.all([run('researcher','70'),run('reviewer','40')]);
 assert.deepEqual(results.sort(),['authorized','denied']);assert.ok(BigInt(ledger.budget('researcher').jobCommittedAtomic)<=100n);
});

test('SIGKILL after submission preserves exact payment and hold on reopening',async t=>{
 const {path}=setup(t);
 const p=spawn(process.execPath,[fileURLToPath(new URL('./crash-worker.ts',import.meta.url)),path],{stdio:['ignore','pipe','pipe','ipc']});
 const id=await new Promise<string>((resolve,reject)=>{p.once('message',(value:any)=>resolve(value.id));p.once('error',reject);p.once('exit',()=>reject(new Error('Worker exited before issuance')));});
 const exited=new Promise<void>(resolve=>p.once('exit',()=>resolve()));p.kill('SIGKILL');await exited;
 const reopened=new Ledger(path,policy());t.after(()=>reopened.close());
 assert.equal(reopened.get('researcher',id).paymentState,'pending');
 assert.equal(reopened.budget('researcher').jobCommittedAtomic,'60');
 assert.equal(reopened.issue('researcher',id,()=>{throw new Error('No new signature after restart');},now).payload,'SIMULATED-survives-process-crash');
 assert.equal(reopened.audit().filter(x=>JSON.parse(x.event).type==='issued').length,1);
});

test('owner approval must compare current head and cannot restore a superseded revision',t=>{
 const {ledger}=setup(t);const first=ledger.authorize('researcher',offer(),now).order!;
 const second=ledger.authorize('researcher',offer({revision:'2'}),now,{expectedOrderId:first.id,expectedRevision:'1'}).order!;
 assert.equal(ledger.authorize('researcher',offer({revision:'3'}),now,{expectedOrderId:first.id,expectedRevision:'1'}).decision.code,'stale_owner_approval');
 assert.equal(ledger.authorize('researcher',offer(),now,{expectedOrderId:second.id,expectedRevision:'2'}).decision.code,'superseded_revision');
 assert.equal(ledger.authorize('researcher',offer({revision:'2'}),now).order!.id,second.id);
});
test('paid exact terms replay after offer and grant expiry, without a new authorization',t=>{
 const {ledger}=setup(t);const id=ledger.authorize('researcher',offer(),now).order!.id;
 ledger.issue('researcher',id,()=> 'SIMULATED-expired',now);ledger.reconcile(success(ledger.submission(id,'SIMULATED-expired-tx')));
 assert.equal(ledger.authorize('researcher',offer(),new Date('2031-01-01T00:00:00Z')).order?.id,id);
 assert.equal(ledger.authorize('researcher',offer({operationId:'new'}),new Date('2031-01-01T00:00:00Z')).kind,'denied');
});

test('owner replacement cannot create a different operation or approve an absent head',t=>{
 const {ledger}=setup(t);const first=ledger.authorize('researcher',offer(),now).order!;
 assert.equal(ledger.authorize('researcher',offer({operationId:'different',amountAtomic:'5'}),now,{expectedOrderId:first.id,expectedRevision:'1'}).decision.code,'stale_owner_approval');
 assert.equal(ledger.budget('researcher').jobCommittedAtomic,'60');
});
test('deferred retry checks fresh budget, expiry and stop; explicit cancellation stays terminal',t=>{
 const {ledger,path}=setup(t);const initial=ledger.authorize('researcher',offer(),now).order!;
 ledger.defer('researcher',initial.id);assert.equal(ledger.budget('researcher').jobCommittedAtomic,'0');
 const second=new Ledger(path,policy());t.after(()=>second.close());
 const other=second.authorize('researcher',offer({operationId:'other',amountAtomic:'20'}),now).order!;
 assert.equal(second.authorize('researcher',offer(),now).kind,'denied');
 assert.equal(second.get('researcher',initial.id).paymentState,'deferred');
 second.cancel('researcher',other.id);
 assert.equal(second.authorize('researcher',offer(),new Date('2031-01-01T00:00:00Z')).kind,'denied');
 const retried=second.authorize('researcher',offer(),now);assert.equal(retried.kind,'authorized');assert.equal(retried.order?.id,initial.id);
 second.defer('researcher',initial.id);second.stop();assert.equal(second.authorize('researcher',offer(),now).decision.code,'job_stopped');
 second.cancel('researcher',initial.id);assert.equal(second.authorize('researcher',offer(),now).order?.paymentState,'cancelled');
 assert.equal(second.budget('researcher').jobCommittedAtomic,'0');
});
