import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../packages/ledger/index.ts';
import { FixtureSigner } from '../packages/wallet/index.ts';
import { FixtureRail } from '../packages/wallet/fixture-rail.ts';
import { operationFor } from '../packages/poppy/live.ts';
import { sha256 } from '../packages/core/index.ts';
import type { Offer,Policy } from '../packages/core/index.ts';
import { purchaseService,CommerceError } from '../packages/commerce/index.ts';
import type { CommerceOptions,CommerceResponse } from '../packages/commerce/index.ts';

function fixture(){
 const expiresAt='2029-01-01T00:00:00Z',origin='https://fixture.example';
 const offer:Offer={operationId:'research',revision:'1',jobId:'job',supplierId:'seller',origin,url:origin+'/report',method:'GET',bodyHash:sha256(''),network:'near:testnet',asset:'fixture.testnet',payer:'buyer.testnet',payTo:'seller.testnet',amountAtomic:'10',expiresAt};
 const policy:Policy={id:'policy',version:'1',jobId:'job',network:'near:testnet',asset:offer.asset,payer:offer.payer,jobBudgetAtomic:'10',expiresAt,suppliers:[{id:'seller',origin,payTo:offer.payTo}],grants:[{principalId:'buyer',suppliers:['seller'],maxPerPurchaseAtomic:'10',maxTotalAtomic:'10',expiresAt}]};
 const ledger=new Ledger(':memory:',policy),rail=new FixtureRail(':memory:');let issueCalls=0,requests=0,paidCalls=0;
 const response=(status:number,body:unknown,headers:Record<string,string>={}):CommerceResponse=>({status,text:JSON.stringify(body),headers});
 const options:CommerceOptions={principalId:'buyer',offer,maxTimeoutSeconds:60,now:()=>1800000000,
  sessionHeaders:async()=>({'Poppy-Session':'SIMULATED-SESSION'}),approve:async()=>({approver:'agent',reference:'fixture-reference',approvedAt:1800000000}),
  transport:async req=>{
   requests++;assert.equal(req.url,offer.url);
   if(!req.headers['Poppy-Approval'])return response(403,{error:'approval_required',operation:operationFor(offer)});
   if(!req.headers['PAYMENT-SIGNATURE'])return response(402,{error:'payment_required'},{'payment-required':Buffer.from(JSON.stringify({x402Version:2,resource:{url:offer.url},accepts:[{scheme:'exact',network:offer.network,amount:offer.amountAtomic,asset:offer.asset,payTo:offer.payTo,maxTimeoutSeconds:60}]})).toString('base64')});
   paidCalls++;const order=ledger.lookup('buyer',offer)!;const payload=Buffer.from(req.headers['PAYMENT-SIGNATURE'],'base64').toString();
   const tx=rail.prepare(order,payload,'success');let current=order;if(current.paymentState==='issued')current=ledger.submission(order.id,tx);ledger.reconcile(rail.inspect(current)!);
   return response(200,{simulation:true,report:'fixture result'},{'payment-response':Buffer.from(JSON.stringify({success:true,network:offer.network,payer:offer.payer,transaction:tx})).toString('base64')});
  },
  authorizeAndIssue:async value=>{issueCalls++;const auth=ledger.authorize('buyer',value);if(!auth.order)throw new Error('Refused');return ledger.issue('buyer',auth.order.id,o=>new FixtureSigner().sign(o));},
  verifySettlement:async({order})=>rail.inspect(ledger.get('buyer',order.id))!,
  deliver:async(id,text)=>ledger.deliver('buyer',id,text),
 };
 return {options,ledger,rail,response,get issueCalls(){return issueCalls;},get requests(){return requests;},get paidCalls(){return paidCalls;},close(){rail.close();ledger.close();}};
}
test('commerce SDK completes pinned Poppy/x402 fixture with trusted settlement and exact replay',async()=>{
 const f=fixture();try{
  const result=await purchaseService(f.options);assert.equal(result.exactRetryVerified,true);assert.deepEqual(result.result,{simulation:true,report:'fixture result'});assert.ok(result.transactionId.startsWith('SIMULATED-TX-'));assert.equal(f.issueCalls,1);assert.equal(f.paidCalls,2);assert.equal(f.ledger.budget('buyer').jobCommittedAtomic,'10');
  const repeat=await purchaseService(f.options);assert.equal(repeat.orderId,result.orderId);assert.equal(f.ledger.audit().filter(e=>JSON.parse(e.event).type==='issued').length,1);assert.equal(JSON.stringify(result).includes('SIMULATED-SESSION'),false);assert.equal(Object.hasOwn(result,'payload'),false);
 }finally{f.close();}
});
test('changed operation and price refuse before host authorization',async()=>{
 for(const phase of ['operation','price']){const f=fixture();try{
  const transport=f.options.transport;f.options.transport=async req=>{const response=await transport(req);if(phase==='operation'&&response.status===403){const body=JSON.parse(response.text);body.operation.terms.recipient='attacker.testnet';response.text=JSON.stringify(body);}if(phase==='price'&&response.status===402){const challenge=JSON.parse(Buffer.from(response.headers['payment-required']!,'base64').toString());challenge.accepts[0].payTo='attacker.testnet';return {...response,headers:{'payment-required':Buffer.from(JSON.stringify(challenge)).toString('base64')}};}return response;};
  await assert.rejects(purchaseService(f.options),e=>e instanceof CommerceError&&e.stage===phase);assert.equal(f.issueCalls,0);
 }finally{f.close();}}
});
test('merchant success without trusted final correlated settlement never delivers',async()=>{
 for(const change of ['unknown','transaction','recipient']){const f=fixture();try{
  const verify=f.options.verifySettlement;f.options.verifySettlement=async(input,signal)=>{const e=await verify(input,signal);return {...e,...(change==='unknown'?{final:false,outcome:'unknown' as const}:change==='transaction'?{transactionId:'wrong'}:{payTo:'wrong.testnet'})};};
  await assert.rejects(purchaseService(f.options),e=>e instanceof CommerceError&&e.stage==='settlement');assert.equal(f.ledger.lookup('buyer',f.options.offer)!.deliveryState,'not_delivered');assert.equal(f.ledger.budget('buyer').jobCommittedAtomic,'10');
 }finally{f.close();}}
});
test('malformed or contradictory paid receipt and changing repeat result are rejected',async()=>{
 for(const mutation of ['missing','payer','repeat']){const f=fixture();try{
  const transport=f.options.transport;f.options.transport=async req=>{const result=await transport(req);if(result.status!==200)return result;if(mutation==='missing')return {...result,headers:{}};if(mutation==='payer'){const receipt=JSON.parse(Buffer.from(result.headers['payment-response']!,'base64').toString());receipt.payer='attacker';return {...result,headers:{'payment-response':Buffer.from(JSON.stringify(receipt)).toString('base64')}};}if(f.paidCalls===2)return {...result,text:'{"changed":true}'};return result;};
  await assert.rejects(purchaseService(f.options),CommerceError);assert.equal(f.ledger.lookup('buyer',f.options.offer)!.deliveryState,'not_delivered');
 }finally{f.close();}}
});
test('SDK refuses redirect/session injection and redacts host errors',async()=>{
 for(const mutation of ['redirect','headers','error']){const f=fixture();try{
  if(mutation==='redirect')f.options.transport=async()=>f.response(302,{location:'https://attacker.example'});
  if(mutation==='headers')f.options.sessionHeaders=async()=>({'Poppy-Session':'fixture',Authorization:'SECRET'});
  if(mutation==='error')f.options.transport=async()=>{throw new Error('SECRET wallet material');};
  await assert.rejects(purchaseService(f.options),e=>e instanceof CommerceError&&!e.message.includes('SECRET'));assert.equal(f.issueCalls,0);
 }finally{f.close();}}
});
test('SDK deadline rejects a noncooperating transport and never invokes issuance',async()=>{
 const f=fixture();try{f.options.timeoutMs=10;f.options.transport=async()=>new Promise(()=>{});await assert.rejects(purchaseService(f.options),CommerceError);assert.equal(f.issueCalls,0);}finally{f.close();}
});
