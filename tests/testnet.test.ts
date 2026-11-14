import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair,decodeSignedDelegate,encodeSignedDelegate,encodeDelegateAction,Signature } from 'near-api-js';
import { createHash } from 'node:crypto';
import { preparePayer,checkPayment,preflight,TestnetRail,assertTestnet } from '../packages/near/testnet.ts';
import type { Payment,Rpc } from '../packages/near/testnet.ts';
import { canonical,sha256 } from '../packages/core/index.ts';
import type { Order } from '../packages/core/index.ts';
import { offer } from './fixtures.ts';
import { Ledger } from '../packages/ledger/index.ts';
import { policy } from './fixtures.ts';

const key=KeyPair.fromRandom('ed25519'),relayer=KeyPair.fromRandom('ed25519');
const terms=offer({asset:'wrap.testnet'});
const mock:Rpc=async(method,p)=>{
 if(method==='status')return {chain_id:'testnet'};
 if(method==='block')return {header:{height:1000}};
 if(p.request_type==='view_access_key')return {nonce:1,permission:'FullAccess',block_hash:'11111111111111111111111111111111'};
 if(p.request_type==='view_account')return {code_hash:'test-deployed-code',amount:'100'};
 if(p.method_name)return {result:[...Buffer.from(JSON.stringify(p.method_name==='ft_balance_of'?'100000000':{total:'100',available:'0'}))]};
 throw Error('Unexpected mock call');
};
async function issued(){const payload=(await preparePayer(terms,key,mock))();const order:Order={id:'test-order',principalId:'researcher',offer:terms,fingerprint:sha256(canonical(terms)),policyVersion:'1',paymentState:'issued',deliveryState:'not_delivered',payloadHash:sha256(payload),createdAt:new Date().toISOString()};return {payload,order};}
test('testnet adapter verifies real ed25519/Borsh signatures and exact resource terms with mocked chain',async()=>{
 const {payload}=await issued(),payment=JSON.parse(payload) as Payment;
 const signed=checkPayment(payment,terms,key.getPublicKey().toString());await preflight(signed,terms,mock);
 assert.throws(()=>checkPayment({...payment,resource:{url:terms.url+'?other'}},terms,key.getPublicKey().toString()),/challenge/);
 assert.throws(()=>checkPayment({...payment,accepted:{...payment.accepted,amount:'1'}},terms,key.getPublicKey().toString()),/challenge/);
 const broken=Buffer.from(payment.payload.signedDelegateAction,'base64');broken[broken.length-1]^=1;
 assert.throws(()=>checkPayment({...payment,payload:{signedDelegateAction:broken.toString('base64')}},terms,key.getPublicKey().toString()),/signature/);
 const trailing=Buffer.concat([Buffer.from(payment.payload.signedDelegateAction,'base64'),Buffer.from([0])]);
 assert.throws(()=>checkPayment({...payment,payload:{signedDelegateAction:trailing.toString('base64')}},terms,key.getPublicKey().toString()));
});
test('valid signature cannot change transfer arguments, gas, deposit or action count',async()=>{
 const {payload}=await issued(),payment=JSON.parse(payload) as Payment;
 for(const change of [(d:any)=>{d.actions[0].functionCall.deposit=0n;},(d:any)=>{d.actions[0].functionCall.gas=31_000_000_000_000n;},(d:any)=>{d.actions.push(d.actions[0]);},(d:any)=>{d.actions[0].functionCall.args=Buffer.from('{"amount":"60","amount":"1","receiver_id":"supplier.testnet"}');}]){
  const signed=decodeSignedDelegate(Buffer.from(payment.payload.signedDelegateAction,'base64'));change(signed.delegateAction);
  signed.signature=new Signature({keyType:0,data:key.sign(createHash('sha256').update(encodeDelegateAction(signed.delegateAction)).digest()).signature});
  assert.throws(()=>checkPayment({...payment,payload:{signedDelegateAction:Buffer.from(encodeSignedDelegate(signed)).toString('base64')}},terms,key.getPublicKey().toString()));
 }
});
test('chain preflight refuses function-call key, used nonce, expired action, insufficient tokens and missing registration',async()=>{
 const {payload}=await issued(),signed=checkPayment(JSON.parse(payload),terms,key.getPublicKey().toString());
 for(const bad of ['key','nonce','expiry','balance','storage','malformed_storage']){
  const call:Rpc=async(method,p)=>{
   const r=await mock(method,p);
   if(bad==='key'&&p.request_type==='view_access_key')r.permission={FunctionCall:{}};
   if(bad==='nonce'&&p.request_type==='view_access_key')r.nonce=2;
   if(bad==='expiry'&&method==='block')r.header.height=1120;
   if(bad==='balance'&&p.method_name==='ft_balance_of')r.result=[...Buffer.from('"0"')];
   if(bad==='storage'&&p.method_name==='storage_balance_of')r.result=[...Buffer.from('null')];
   if(bad==='malformed_storage'&&p.method_name==='storage_balance_of')r.result=[...Buffer.from('"invalid"')];
   return r;
  };
  await assert.rejects(preflight(signed,terms,call));
 }
 await assert.rejects(assertTestnet(async()=>({chain_id:'mainnet'})),/not testnet/);
});
test('unknown relay survives reopening and retries only the same signed outer transaction',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'live-rail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {payload,order}=await issued();let prepared=0;const sent:string[]=[];
 const call:Rpc=async(method,p)=>{if(method==='tx')throw Error('UNKNOWN_TRANSACTION');if(method==='send_tx'){sent.push(String(p.signed_tx_base64));throw Error('transport lost');}if(p.account_id==='relay.testnet'&&p.request_type==='view_access_key')prepared++;return mock(method,p);};
 let rail=new TestnetRail(join(dir,'rail.db'),'relay.testnet',relayer.toString(),key.getPublicKey().toString(),call);
 const result=await rail.settle(order,payload);assert.equal(result.final_execution_status,'NONE');rail.close();
 rail=new TestnetRail(join(dir,'rail.db'),'relay.testnet',relayer.toString(),key.getPublicKey().toString(),call);
 t.after(()=>rail.close());const again=await rail.settle(order,payload);
 assert.equal(again.transaction.hash,result.transaction.hash);assert.equal(prepared,1);assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
 await assert.rejects(rail.settle({...order,id:'other-order'},payload),/another order/);
 const before=sent.length;await assert.rejects(rail.settle({...order,payloadHash:'0'.repeat(64)},payload),/mismatch/);assert.equal(sent.length,before);
});
test('wrong-hash FINAL RPC result is rejected without poisoning persisted recovery',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'live-rail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {payload,order}=await issued();let wrong=true;
 const call:Rpc=async(method,p)=>{if(method==='tx')return {final_execution_status:'FINAL',transaction:{hash:wrong?'wrong':p.tx_hash}};return mock(method,p);};
 const rail=new TestnetRail(join(dir,'rail.db'),'relay.testnet',relayer.toString(),key.getPublicKey().toString(),call);t.after(()=>rail.close());
 await assert.rejects(rail.settle(order,payload),/Uncorrelated/);wrong=false;
 assert.notEqual((await rail.settle(order,payload)).transaction.hash,'wrong');
});
test('supplier exact lookup never reserves funds and rejects another principal or changed terms',()=>{
 const ledger=new Ledger(':memory:',policy());try{
  assert.equal(ledger.lookup('researcher',offer()),undefined);assert.equal(ledger.audit().length,0);
  ledger.authorize('researcher',offer(),new Date('2026-11-14T00:00:00Z'));
  assert.throws(()=>ledger.lookup('reviewer',offer()),/another principal/);
  assert.throws(()=>ledger.lookup('researcher',offer({amountAtomic:'61'})),/terms mismatch/);
 }finally{ledger.close();}
});
