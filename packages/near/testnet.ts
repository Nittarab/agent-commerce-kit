import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { KeyPair, PublicKey, Signature, SignedDelegate, actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, decodeSignedDelegate, createTransaction, SignedTransaction, baseEncode, baseDecode } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import type { Offer, Order } from '../core/index.ts';
import { atomic, canonical, sha256 } from '../core/index.ts';
import { inspectNearSettlement } from './index.ts';

export const TESTNET_RPC = 'https://rpc.testnet.near.org';
export const TOKEN = 'wrap.testnet';
export const GAS = 30_000_000_000_000n;
export const TIMEOUT = 120;
export type Requirement = {scheme:'exact';network:'near:testnet';amount:string;asset:string;payTo:string;maxTimeoutSeconds:number};
export type Payment = {x402Version:2;resource:{url:string};accepted:Requirement;payload:{signedDelegateAction:string}};
export type Rpc = (method:string, params:Record<string,unknown>)=>Promise<any>;
export const rpc:Rpc = async(method,params)=>{
 const response=await fetch(TESTNET_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'agent-kit',method,params}),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new Error('Testnet RPC HTTP '+response.status);
 const text=await response.text();
 // Preserve unsafe RPC integers as decimal strings; never round a nonce.
 const json=JSON.parse(text,(key:string,value:any,context?:{source:string})=>typeof value==='number'&&!Number.isSafeInteger(value)?context!.source:value);
 if(json.error)throw new Error('Testnet RPC '+JSON.stringify(json.error));
 return json.result;
};
export async function assertTestnet(call:Rpc=rpc){if((await call('status',{})).chain_id!=='testnet')throw new Error('RPC is not testnet');}
export async function view(method:string,args:Record<string,unknown>,call:Rpc=rpc):Promise<any>{
 const result=await call('query',{request_type:'call_function',account_id:TOKEN,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64'),finality:'final'});
 return JSON.parse(Buffer.from(result.result).toString('utf8'));
}
export function requirement(offer:Offer):Requirement{return {scheme:'exact',network:'near:testnet',amount:offer.amountAtomic,asset:offer.asset,payTo:offer.payTo,maxTimeoutSeconds:TIMEOUT};}
export function checkPayment(payment:Payment,offer:Offer,expectedKey:string){
 if(payment.x402Version!==2||canonical(payment.accepted)!==canonical(requirement(offer))||canonical(payment.resource)!==canonical({url:offer.url})||Object.keys(payment).sort().join(',')!=='accepted,payload,resource,x402Version'||Object.keys(payment.payload).join(',')!=='signedDelegateAction')throw new Error('Payment differs from exact challenge');
 const encoded=payment.payload.signedDelegateAction;
 if(typeof encoded!=='string'||encoded.length>8192)throw new Error('Invalid delegate size');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded)throw new Error('Invalid delegate encoding');
 const signed=decodeSignedDelegate(bytes),d=signed.delegateAction;
 if(!Buffer.from(encodeSignedDelegate(signed)).equals(bytes))throw new Error('Noncanonical delegate bytes');
 if(!expectedKey.startsWith('ed25519:')||d.publicKey.toString()!==expectedKey||signed.signature.signatureType!==0)throw new Error('Only pinned ed25519 payer supported');
 if(!d.publicKey.verify(createHash('sha256').update(encodeDelegateAction(d)).digest(),signed.signature.data))throw new Error('Invalid delegate signature');
 if(offer.network!=='near:testnet'||offer.asset!==TOKEN||d.senderId!==offer.payer||d.receiverId!==offer.asset||d.actions.length!==1||d.actions[0].enum!=='functionCall')throw new Error('Invalid delegate target/actions');
 const f=d.actions[0].functionCall!;
 const args=Buffer.from(f.args).toString('utf8');
 // This restricted profile uses exact canonical JSON; duplicates and unknown arguments are refused.
 if(f.methodName!=='ft_transfer'||f.deposit!==1n||f.gas!==GAS||args!==canonical({receiver_id:offer.payTo,amount:offer.amountAtomic}))throw new Error('Invalid transfer terms');
 atomic(offer.amountAtomic);
 return signed;
}
export async function preflight(signed:SignedDelegate,offer:Offer,call:Rpc=rpc){
 const d=signed.delegateAction;
 const [block,key,payer,token,balance,storage]=await Promise.all([
  call('block',{finality:'final'}),call('query',{request_type:'view_access_key',account_id:offer.payer,public_key:d.publicKey.toString(),finality:'final'}),
  call('query',{request_type:'view_account',account_id:offer.payer,finality:'final'}),call('query',{request_type:'view_account',account_id:TOKEN,finality:'final'}),
  view('ft_balance_of',{account_id:offer.payer},call),view('storage_balance_of',{account_id:offer.payTo},call)
 ]);
 const height=BigInt(block.header.height),remaining=d.maxBlockHeight-height;
 if(key.permission!=='FullAccess'||d.nonce<=BigInt(key.nonce)||d.nonce>=height*1_000_000n||remaining<=0n||remaining>BigInt(TIMEOUT))throw new Error('Delegate key, nonce or expiry invalid');
 if(!payer||typeof token.code_hash!=='string'||!token.code_hash||token.code_hash==='1'.repeat(32)||atomic(balance,true)<atomic(offer.amountAtomic)||!storage||typeof storage!=='object'||Array.isArray(storage))throw new Error('Token preflight failed');
 atomic(payer.amount,true);
 if(atomic(storage.available,true)>atomic(storage.total,true))throw new Error('Invalid token storage balance');
}
export async function preparePayer(offer:Offer,key:KeyPair,call:Rpc=rpc){
 const [block,access]=await Promise.all([call('block',{finality:'final'}),call('query',{request_type:'view_access_key',account_id:offer.payer,public_key:key.getPublicKey().toString(),finality:'final'})]);
 if(access.permission!=='FullAccess')throw new Error('Payer key must have full access');
 const d=buildDelegateAction({senderId:offer.payer,receiverId:offer.asset,publicKey:key.getPublicKey(),nonce:BigInt(access.nonce)+1n,maxBlockHeight:BigInt(block.header.height)+BigInt(TIMEOUT),actions:[actions.functionCall('ft_transfer',Buffer.from(canonical({receiver_id:offer.payTo,amount:offer.amountAtomic})),GAS,1n)]});
 // Synchronous closure: invoke only inside Ledger.issue after the reservation exists.
 return ()=>{
  const signature=key.sign(createHash('sha256').update(encodeDelegateAction(d)).digest());
  const signed=new SignedDelegate({delegateAction:d,signature:new Signature({keyType:0,data:signature.signature})});
  const payment:Payment={x402Version:2,resource:{url:offer.url},accepted:requirement(offer),payload:{signedDelegateAction:Buffer.from(encodeSignedDelegate(signed)).toString('base64')}};
  return canonical(payment);
 };
}

type Attempt = {payload_hash:string;order_id:string;delegate_hash:string;tx_id:string;raw_tx:string;result:string|null};
/** One host-held relayer, single process writer. Runner owns an exclusive process lock. */
export class TestnetRail {
 private db:DatabaseSync;
 private tail:Promise<unknown>=Promise.resolve();
 #key:KeyPair;
 readonly relayer:string;
 private expectedPayerKey:string;
 private call:Rpc;
 constructor(path:string,relayer:string,privateKey:KeyPairString,expectedPayerKey:string,call:Rpc=rpc){
  this.relayer=relayer;this.expectedPayerKey=expectedPayerKey;this.call=call;
  this.#key=KeyPair.fromString(privateKey);this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS attempts(payload_hash TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,delegate_hash TEXT UNIQUE NOT NULL,tx_id TEXT UNIQUE NOT NULL,raw_tx TEXT NOT NULL,result TEXT)');
 }
 close(){this.db.close();}
 private stored(hash:string){return this.db.prepare('SELECT * FROM attempts WHERE payload_hash=?').get(hash) as Attempt|undefined;}
 settle(order:Order,payload:string):Promise<any>{
  const run=this.tail.then(()=>this.execute(order,payload));this.tail=run.catch(()=>{});return run;
 }
 private async execute(order:Order,payload:string){
  const hash=sha256(payload);if(hash!==order.payloadHash)throw new Error('Issued payload mismatch');
  const payment=JSON.parse(payload) as Payment,signed=checkPayment(payment,order.offer,this.expectedPayerKey);
  if(this.relayer===order.offer.payer)throw new Error('Distinct relayer required');
  let attempt=this.stored(hash);
  if(attempt&&attempt.order_id!==order.id)throw new Error('Payment is bound to another order');
  if(!attempt){
   await preflight(signed,order.offer,this.call);
   const access=await this.call('query',{request_type:'view_access_key',account_id:this.relayer,public_key:this.#key.getPublicKey().toString(),finality:'final'});
   if(access.permission!=='FullAccess')throw new Error('Relayer full access required');
   const tx=createTransaction(this.relayer,this.#key.getPublicKey(),order.offer.payer,BigInt(access.nonce)+1n,[actions.signedDelegate(signed)],baseDecode(access.block_hash));
   const txHash=createHash('sha256').update(tx.encode()).digest();
   const outer=new SignedTransaction({transaction:tx,signature:new Signature({keyType:0,data:this.#key.sign(txHash).signature})});
   const txId=baseEncode(txHash),raw=Buffer.from(outer.encode()).toString('base64');
   this.db.prepare('INSERT INTO attempts(payload_hash,order_id,delegate_hash,tx_id,raw_tx) VALUES (?,?,?,?,?)').run(hash,order.id,sha256(Buffer.from(encodeSignedDelegate(signed))),txId,raw);
   attempt=this.stored(hash)!;
  }
  if(attempt.result)return JSON.parse(attempt.result);
  // Saved bytes and transaction hash precede all broadcast. Uncertain requests never sign a replacement.
  let result:any;
  try {result=await this.call('tx',{tx_hash:attempt.tx_id,sender_account_id:this.relayer,wait_until:'FINAL'});}catch{}
  if(!result||result.final_execution_status!=='FINAL'){
   try {result=await this.call('send_tx',{signed_tx_base64:attempt.raw_tx,wait_until:'FINAL'});}catch{
    try {result=await this.call('tx',{tx_hash:attempt.tx_id,sender_account_id:this.relayer,wait_until:'FINAL'});}catch{}
   }
  }
  if(result?.final_execution_status==='FINAL'){
   if(result.transaction?.hash!==attempt.tx_id)throw new Error('Uncorrelated RPC result');
   this.db.prepare('UPDATE attempts SET result=? WHERE payload_hash=?').run(JSON.stringify(result),hash);
   return result;
  }
  return {transaction:{hash:attempt.tx_id},final_execution_status:'NONE'};
 }
 /** Read and revalidate persisted FINAL evidence only. Never signs, queries RPC, or submits. */
 storedEvidence(order:Order,payload:string){
  if(sha256(payload)!==order.payloadHash)throw new Error('Issued payload mismatch');
  const attempt=this.stored(order.payloadHash);
  if(!attempt||attempt.order_id!==order.id||!attempt.result)throw new Error('No persisted final settlement evidence');
  if(order.transactionId!==undefined&&order.transactionId!==attempt.tx_id)throw new Error('Settlement transaction mismatch');
  return this.evidence(order,payload,JSON.parse(attempt.result));
 }
 evidence(order:Order,payload:string,result:any){
  const signed=checkPayment(JSON.parse(payload),order.offer,this.expectedPayerKey),d=signed.delegateAction;
  const attempt=this.stored(sha256(payload));
  if(!attempt||attempt.order_id!==order.id||result?.transaction?.hash!==attempt.tx_id)throw new Error('Uncorrelated transaction');
  // The recorded transaction hash commits to our exact signed outer bytes, including this delegate.
  const delegateId=result.transaction_outcome?.outcome?.status?.SuccessReceiptId;
  const delegate=result.receipts_outcome?.find((r:any)=>r.id===delegateId);
  const children=(result.receipts_outcome??[]).filter((r:any)=>delegate?.outcome?.receipt_ids?.includes(r.id)&&r.outcome.executor_id===order.offer.asset);
  return inspectNearSettlement({order:{...order,transactionId:attempt.tx_id},expectedPublicKey:this.expectedPayerKey,rpc:result,verifiedTransfer:children.length===1?{transactionId:attempt.tx_id,network:'near:testnet',payloadHash:sha256(payload),relayer:this.relayer,delegateReceiptId:delegateId,transferReceiptId:children[0].id,payer:d.senderId,publicKey:d.publicKey.toString(),asset:d.receiverId,payTo:order.offer.payTo,amountAtomic:order.offer.amountAtomic,actionCount:1,methodName:'ft_transfer',deposit:'1'}:undefined});
 }
}
