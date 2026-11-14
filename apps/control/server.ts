import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Ledger } from '../../packages/ledger/index.ts';
import type { Offer, Order, SettlementEvidence } from '../../packages/core/index.ts';
import { FixtureSigner } from '../../packages/wallet/index.ts';
import { FixtureRail } from '../../packages/wallet/fixture-rail.ts';

export type SimulationFault = 'unknown' | 'lost_response' | 'final_failure';
export type ControlOptions = { ledger: Ledger; tokens: ReadonlyMap<string,string>; ownerToken: string; faults?: ReadonlyMap<string,SimulationFault>; now?: () => Date };
function equal(a:string,b:string) { const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb); }
function response(res:ServerResponse,status:number,value:unknown) { res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value)); }
async function json(req:IncomingMessage):Promise<Record<string,unknown>> {
 let data='';for await(const part of req){data+=part.toString();if(Buffer.byteLength(data)>65536) throw new Error('Request exceeds 64 KiB');}
 const value=JSON.parse(data);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected JSON object');return value;
}
function exact(input:Record<string,unknown>,keys:string[]) { if(Object.keys(input).some(k=>!keys.includes(k)))throw new Error('Unexpected request field'); }
export function fixtureResult(offer:Offer):string {
 return JSON.stringify({simulation:true,service:new URL(offer.url).pathname,facts:[{name:'Alpha',value:7},{name:'Beta',value:11}],source:'local deterministic fixture',requestBodyHash:offer.bodyHash});
}
/** SIMULATION ONLY. A local authenticated controller; it never calls a chain or live service. */
export function createControlServer(options:ControlOptions) {
 if(options.ownerToken.length<32 || options.tokens.size===0)throw new Error('Strong owner and actor tokens are required');
 for(const token of options.tokens.keys())if(token.length<32||equal(token,options.ownerToken))throw new Error('Actor tokens must be strong and distinct from owner');
 const signer=new FixtureSigner(),ledger=options.ledger,now=options.now??(()=>new Date());
 const rail=new FixtureRail(ledger.storagePath===':memory:'?':memory:':ledger.storagePath+'.fixture');
 function progress(principal:string,original:Order):Order {
  let order=original;
  if(order.paymentState==='reserved'||order.paymentState==='issued') {
   const issued=ledger.issue(principal,order.id,value=>signer.sign(value),now());
   const fault=options.faults?.get(order.offer.operationId);
   const tx=rail.prepare(issued.order,issued.payload,fault==='unknown'?'unknown':fault==='final_failure'?'failure':'success');
   order=ledger.submission(order.id,tx);
  }
  if(order.paymentState==='pending') {
   const evidence=rail.inspect(order);
   if(evidence) order=ledger.reconcile(evidence);
  }
  return order;
 }
 const server=createServer(async(req,res)=>{
  try {
   const header=req.headers.authorization??'', token=header.startsWith('Bearer ')?header.slice(7):'';
   const owner=equal(token,options.ownerToken);let principal:string|undefined;
   for(const [key,value] of options.tokens)if(equal(token,key))principal=value;
   if(!owner&&!principal){response(res,401,{error:'unauthorized'});return;}
   if(req.method==='GET'&&req.url==='/budget'&&principal){response(res,200,{simulation:true,...ledger.budget(principal)});return;}
   if(req.method!=='POST'){response(res,404,{error:'not_found'});return;}
   const body=await json(req);
   if(req.url==='/owner/stop'&&owner){exact(body,[]);ledger.stop();response(res,200,{stopped:true});return;}
   if(req.url==='/owner/approve-revision'&&owner){exact(body,['principalId','offer','expectedOrderId','expectedRevision']);if(typeof body.principalId!=='string'||typeof body.expectedOrderId!=='string'||typeof body.expectedRevision!=='string')throw new Error('Principal and expected current revision required');response(res,200,{simulation:true,...ledger.authorize(body.principalId,body.offer as Offer,now(),{expectedOrderId:body.expectedOrderId,expectedRevision:body.expectedRevision})});return;}
   if(req.url?.startsWith('/owner/')){response(res,403,{error:'owner_required'});return;}
   if(!principal){response(res,403,{error:'actor_required'});return;}
   if(req.url==='/cancel') {exact(body,['orderId']);if(typeof body.orderId!=='string')throw new Error('Order ID required');response(res,200,{simulation:true,order:ledger.cancel(principal,body.orderId)});return;}
   if(req.url==='/recover'){
    exact(body,['orderId']);if(typeof body.orderId!=='string')throw new Error('Order ID required');let order=ledger.get(principal,body.orderId);
    if(['issued','pending'].includes(order.paymentState))order=progress(principal,order);
    if(order.paymentState==='settled'&&order.deliveryState==='not_delivered')order=ledger.deliver(principal,order.id,fixtureResult(order.offer));
    response(res,200,{simulation:true,order});return;
   }
   if(req.url!=='/purchase'){response(res,404,{error:'not_found'});return;}
   exact(body,['offer']);const auth=ledger.authorize(principal,body.offer as Offer,now());
   if(!auth.order){response(res,auth.kind==='awaiting_approval'?409:403,{simulation:true,...auth});return;}
   let order=auth.order;
   if(order.paymentState==='settled'){
    if(order.deliveryState==='not_delivered')order=ledger.deliver(principal,order.id,fixtureResult(order.offer));
    response(res,200,{simulation:true,kind:'replay',order});return;
   }
   if(['failed','cancelled'].includes(order.paymentState)){response(res,200,{simulation:true,kind:'replay',order});return;}
   try {order=progress(principal,order);} catch(error) {
    // Release an unissued hold for a future fresh authorization; never release an issued attempt.
    order=ledger.get(principal,order.id);
    if(order.paymentState==='reserved')order=ledger.defer(principal,order.id);
    response(res,409,{simulation:true,kind:'blocked',order,error:error instanceof Error?error.message:'issuance_blocked'});return;
   }
   if(auth.kind==='authorized'&&options.faults?.get(order.offer.operationId)==='lost_response'&&order.paymentState==='settled'){res.destroy();return;}
   if(order.paymentState==='settled')order=ledger.deliver(principal,order.id,fixtureResult(order.offer));
   response(res,200,{simulation:true,kind:auth.kind,order});
  }catch(error){if(!res.destroyed&&!res.headersSent)response(res,400,{error:error instanceof Error?error.message:'invalid_request'});}
 });
 server.once('close',()=>rail.close());
 return server;
}
