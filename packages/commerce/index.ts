import { canonical, fingerprint, sha256 } from '../core/index.ts';
import type { Offer, Order, SettlementEvidence } from '../core/index.ts';
import { assertOperation, assertApproval } from '../poppy/live.ts';
import { createApprovalHeader, operationFingerprint } from '../poppy/index.ts';
import { decodePaymentRequired, selectExactRequirement } from '../x402/index.ts';

export type CommerceResponse = { status:number; headers:Readonly<Record<string,string|undefined>>; text:string };
export type CommerceReceipt = { success:true; network:string; payer:string; transaction:string };
export type CommerceApproval = { approver:'agent'; reference:string; approvedAt:number } | { storedHeader:string };
export type CommerceOptions = {
 principalId:string; offer:Offer; maxTimeoutSeconds:number;
 /** Must enforce TLS/origin pins, refuse redirects, bound response bytes, and honor signal. */
 transport:(request:{url:string;method:'GET';headers:Readonly<Record<string,string>>;signal:AbortSignal})=>Promise<CommerceResponse>;
 /** Returns a fresh per-request session; no token is ever returned to the caller. */
 sessionHeaders:(signal:AbortSignal)=>Promise<Readonly<Record<string,string>>>;
 /** Trusted host decision on this exact fingerprint, never a model-supplied approval. */
 approve:(operationFingerprint:string,signal:AbortSignal)=>Promise<CommerceApproval>;
 /** Atomically reserve shared budget before issuance and durably reuse an existing exact attempt. */
 authorizeAndIssue:(offer:Offer,signal:AbortSignal)=>Promise<{order:Order;payload:string}>;
 /** Independently inspect the chain or authoritative persisted settlement; a merchant header alone is insufficient. */
 verifySettlement:(input:{order:Order;payloadHash:string;receipt:CommerceReceipt},signal:AbortSignal)=>Promise<SettlementEvidence>;
 /** Persist immutable delivery only after trusted settlement was established. */
 deliver:(orderId:string,text:string,signal:AbortSignal)=>Promise<Order>;
 signal?:AbortSignal; timeoutMs?:number; now?:()=>number;
};
export type CommerceResult = {orderId:string;operationId:string;transactionId:string;result:unknown;digest:string;exactRetryVerified:true};
export class CommerceError extends Error {
 readonly stage:string;
 constructor(stage:string){super('Purchase could not complete at '+stage+'. Retain any issued or uncertain payment and recover the same operation.');this.name='CommerceError';this.stage=stage;}
}
function header(response:CommerceResponse,name:string):string|undefined {
 const matches=Object.entries(response.headers).filter(([key])=>key.toLowerCase()===name.toLowerCase());
 if(matches.length>1)throw new Error('Duplicate header');return matches[0]?.[1];
}
function parseBody(response:CommerceResponse):unknown {
 if(typeof response.text!=='string'||Buffer.byteLength(response.text)>65536)throw new Error('Invalid result size');
 return JSON.parse(response.text);
}
function receiptFor(response:CommerceResponse,offer:Offer):CommerceReceipt {
 const encoded=header(response,'payment-response');
 if(response.status!==200||typeof encoded!=='string'||!encoded||encoded.length>16384)throw new Error('Missing receipt');
 const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)throw new Error('Bad encoding');
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['success','network','payer','transaction'].includes(k))||value.success!==true||value.network!==offer.network||value.payer!==offer.payer||typeof value.transaction!=='string'||!value.transaction||value.transaction.length>256)throw new Error('Wrong receipt');
 return value;
}
function exactOrder(order:Order,principal:string,offer:Offer){
 if(order.principalId!==principal||canonical(order.offer)!==canonical(offer)||order.fingerprint!==fingerprint(offer))throw new Error('Wrong authorized order');
}
/** Pinned Poppy Operations v3 API + x402 exact NEAR testnet buyer orchestration. No discovery, funding, signing, or chain access is performed by this module itself. */
export async function purchaseService(options:CommerceOptions):Promise<CommerceResult>{
 let stage='configuration';let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const offer=structuredClone(options.offer),principal=options.principalId,timeout=options.timeoutMs??60000;
  const url=new URL(offer.url),origin=new URL(offer.origin);
  if(typeof principal!=='string'||!principal||offer.method!=='GET'||offer.bodyHash!==sha256('')||offer.network!=='near:testnet'||url.protocol!=='https:'||url.origin!==origin.origin||origin.href!==origin.origin+'/'||offer.origin!==origin.origin||url.href!==offer.url||url.username||url.password||url.hash||!Number.isSafeInteger(timeout)||timeout<1||timeout>300000||!Number.isSafeInteger(options.maxTimeoutSeconds)||options.maxTimeoutSeconds<1)throw new Error('Unsupported configuration');
  const controller=new AbortController();timer=setTimeout(()=>controller.abort(),timeout);
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  async function bounded<T>(task:()=>Promise<T>):Promise<T>{
   signal.throwIfAborted();
   return new Promise<T>((resolve,reject)=>{const stop=()=>reject(new Error('Aborted'));signal.addEventListener('abort',stop,{once:true});Promise.resolve().then(()=>{signal.throwIfAborted();return task();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
  }
  async function request(extra:Record<string,string>={}):Promise<CommerceResponse>{
   const session=await bounded(()=>options.sessionHeaders(signal));
   if(Object.keys(session).some(k=>!['poppy-session'].includes(k.toLowerCase()))||Object.values(session).some(v=>typeof v!=='string'||!v||v.length>16384||/[\r\n]/.test(v))||!Object.entries(session).some(([k])=>k.toLowerCase()==='poppy-session')||Object.keys(session).length!==1)throw new Error('Invalid session headers');
   const result=await bounded(()=>options.transport({url:offer.url,method:'GET',headers:{...session,'Poppy-Version':'1.0','Poppy-Extensions':'"operations";v="3"',...extra},signal}));
   if(result.status>=300&&result.status<400)throw new Error('Redirect refused');
   return result;
  }
  stage='operation';const first=await request();if(first.status!==403)throw new Error('Expected approval request');
  const body=parseBody(first) as {error?:unknown;operation?:unknown};if(!body||body.error!=='approval_required')throw new Error('Approval unavailable');
  const operation=assertOperation(body.operation,offer);
  stage='approval';const approval=await bounded(()=>options.approve(operationFingerprint(operation,offer),signal));
  const now=options.now?.()??Math.floor(Date.now()/1000);
  const approvalHeader='storedHeader'in approval?approval.storedHeader:createApprovalHeader(operation,offer,{...approval,fingerprint:operationFingerprint(operation,offer)},'initial',now);
  // A saved exact approval may be expired, but the host still decides whether issuance/replay is authorized.
  assertApproval(approvalHeader,offer,now,'storedHeader'in approval);
  stage='price';const challenge=await request({'Poppy-Approval':approvalHeader});
  selectExactRequirement(decodePaymentRequired(challenge.status,header(challenge,'payment-required')),offer,options.maxTimeoutSeconds);
  stage='issuance';const issued=await bounded(()=>options.authorizeAndIssue(structuredClone(offer),signal));
  exactOrder(issued.order,principal,offer);
  if(!['issued','pending','settled'].includes(issued.order.paymentState)||typeof issued.payload!=='string'||!issued.payload||Buffer.byteLength(issued.payload)>12288||issued.order.payloadHash!==sha256(issued.payload))throw new Error('Invalid issued authorization');
  const paymentHeaders={'Poppy-Approval':approvalHeader,'PAYMENT-SIGNATURE':Buffer.from(issued.payload).toString('base64')};
  stage='payment';const paid=await request(paymentHeaders),receipt=receiptFor(paid,offer),result=parseBody(paid);
  stage='settlement';const evidence=await bounded(()=>options.verifySettlement({order:structuredClone(issued.order),payloadHash:sha256(issued.payload),receipt:structuredClone(receipt)},signal));
  if(evidence.orderId!==issued.order.id||evidence.payloadHash!==sha256(issued.payload)||evidence.transactionId!==receipt.transaction||evidence.final!==true||evidence.outcome!=='success')throw new Error('Settlement unproven');
  for(const key of ['network','asset','payer','payTo','amountAtomic'] as const)if(evidence[key]!==offer[key])throw new Error('Settlement terms changed');
  stage='retry';const repeat=await request(paymentHeaders);receiptFor(repeat,offer);
  if(repeat.text!==paid.text||header(repeat,'payment-response')!==header(paid,'payment-response'))throw new Error('Replay changed');
  stage='delivery';const delivered=await bounded(()=>options.deliver(issued.order.id,paid.text,signal));exactOrder(delivered,principal,offer);
  const digest=sha256(paid.text);
  if(delivered.id!==issued.order.id||delivered.paymentState!=='settled'||delivered.deliveryState!=='delivered'||delivered.transactionId!==receipt.transaction||delivered.payloadHash!==issued.order.payloadHash||delivered.result?.digest!==digest||delivered.result.text!==paid.text)throw new Error('Delivery not persisted exactly');
  return {orderId:delivered.id,operationId:offer.operationId,transactionId:receipt.transaction,result,digest,exactRetryVerified:true};
 }catch{throw new CommerceError(stage);}finally{if(timer)clearTimeout(timer);}
}
