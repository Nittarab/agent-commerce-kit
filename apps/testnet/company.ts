import { createServer } from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import type { JsonWebKey } from 'node:crypto';
import type { Offer } from '../../packages/core/index.ts';
import { canonical,sha256 } from '../../packages/core/index.ts';
import { verifySession } from '../../packages/poppy/index.ts';
import { operationFor,assertApproval } from '../../packages/poppy/live.ts';
import { requirement } from '../../packages/near/testnet.ts';

type Sale={principal:string;offer:Offer};
type PaidResult={transactionId:string;result:unknown};
export function createCompany(config:{origin:string;tls:{key:Buffer;cert:Buffer};database:string;issuer:string;keys:(JsonWebKey&{kid:string})[];sales:Sale[];now?:()=>number;validatePayment:(sale:Sale,payload:string)=>void;settle:(sale:Sale,payload:string)=>Promise<PaidResult>}){
 if(new Set(config.sales.map(s=>canonical([s.principal,s.offer.operationId]))).size!==config.sales.length)throw new Error('Duplicate supplier operation');
 const inFlight=new Map<string,Promise<PaidResult>>();
 const db=new DatabaseSync(config.database);if(config.database!==':memory:')chmodSync(config.database,0o600);
 db.exec('PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS sessions(jti TEXT PRIMARY KEY,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS deliveries(operation TEXT PRIMARY KEY,principal TEXT NOT NULL,terms TEXT NOT NULL,payload_hash TEXT UNIQUE NOT NULL,body TEXT NOT NULL,payment_response TEXT NOT NULL);CREATE TABLE IF NOT EXISTS bindings(operation TEXT PRIMARY KEY,terms TEXT NOT NULL,payload_hash TEXT UNIQUE NOT NULL)');
 const discovery={protocol_version:'1.0',organization:{name:'Private Testnet Supplier',domain:new URL(config.origin).host},apis:[{type:'openapi',url:config.origin+'/openapi.json',description:'Buy a finalized testnet block report'}],extensions:{operations:[{version:'3'}]}};
 const server=createServer(config.tls,async(req,res)=>{
  const respond=(status:number,body:unknown,headers:Record<string,string>={})=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(canonical(body));};
  try{
   if(req.headers.host!==new URL(config.origin).host||req.method!=='GET'||req.headers['transfer-encoding']|| (req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))return respond(400,{error:'invalid_request'});
   const url=config.origin+req.url;
   if(req.url==='/.well-known/poppy.json')return respond(200,discovery);
   if(req.url==='/agent.json')return respond(200,{client_id:config.issuer,client_name:'Private Agent Commerce Kit',jwks_uri:config.origin+'/jwks.json',redirect_uris:[]});
   if(req.url==='/jwks.json')return respond(200,{keys:config.keys});
   if(req.url==='/openapi.json')return respond(200,{openapi:'3.1.0',info:{title:'Private report API',version:'1.0'},servers:[{url:config.origin}],paths:{'/api/report':{get:{description:'Requires Poppy Operations v3 approval and an x402 payment',parameters:[{name:'operation',in:'query',required:true,schema:{type:'string'}}],responses:{'200':{description:'Paid report'},'402':{description:'Exact payment required'},'403':{description:'Operation approval required'}}}}}});
   const sale=config.sales.find(s=>s.offer.url===url);
   if(!sale)return respond(404,{error:'not_found'});
   const token=req.headers['poppy-session'];
   if(req.headers['poppy-version']!=='1.0')return respond(400,{error:'version_unsupported'});
   if(req.headers['poppy-extensions']!=='"operations";v="3"')return respond(403,{error:'extension_required',extension:'operations'});
   if(typeof token!=='string')return respond(400,{error:'invalid_session'});
   let session;
   const now=config.now?.()??Math.floor(Date.now()/1000);
   try {
   const claims=JSON.parse(Buffer.from(token.split('.')[1]??'','base64url').toString());
   session=verifySession(token,{iss:config.issuer,aud:config.origin,sub:sale.principal,sid:claims.sid,request:{url,method:'GET'},approvedRequests:config.sales.map(s=>({url:s.offer.url,method:'GET'})),now},config.keys);
   }catch{return respond(400,{error:'invalid_session'});}
   db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
   try{db.prepare('INSERT INTO sessions VALUES (?,?)').run(session.jti,now+120);}catch{return respond(400,{error:'invalid_session'});}
   const key=canonical([config.issuer,sale.principal,sale.offer.operationId]);
   const previous=db.prepare('SELECT * FROM deliveries WHERE operation=?').get(key) as any;
   const binding=db.prepare('SELECT * FROM bindings WHERE operation=?').get(key) as any;
   if(binding&&binding.terms!==canonical(sale.offer))throw new Error('Operation already bound to different terms');
   const approval=req.headers['poppy-approval'];
   if(!approval)return respond(403,{error:'approval_required',operation:operationFor(sale.offer)});
   assertApproval(approval,sale.offer,now,!!previous||!!binding);
   const signature=req.headers['payment-signature'];
   if(!signature)return respond(402,{error:'payment_required'},{'PAYMENT-REQUIRED':Buffer.from(canonical({x402Version:2,resource:{url:sale.offer.url},accepts:[requirement(sale.offer)]})).toString('base64')});
   if(typeof signature!=='string'||signature.length>16384)throw new Error('Invalid payment header');
   const bytes=Buffer.from(signature,'base64');if(bytes.toString('base64')!==signature)throw new Error('Invalid payment encoding');
   const payload=canonical(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),hash=sha256(payload);
   if(previous){if(previous.principal!==sale.principal||previous.terms!==canonical(sale.offer)||previous.payload_hash!==hash)throw new Error('Operation replay mismatch');return respond(200,JSON.parse(previous.body),{'PAYMENT-RESPONSE':previous.payment_response});}
   config.validatePayment(sale,payload);
   if(binding&&binding.payload_hash!==hash)throw new Error('Operation already has a payment attempt');
   db.prepare('INSERT OR IGNORE INTO bindings VALUES (?,?,?)').run(key,canonical(sale.offer),hash);
   let pending=inFlight.get(key);
   if(!pending){pending=config.settle(sale,payload);inFlight.set(key,pending);}
   let paid:PaidResult;
   try{paid=await pending;}finally{inFlight.delete(key);}
   const paymentResponse=Buffer.from(canonical({success:true,transaction:paid.transactionId,network:'near:testnet',payer:sale.offer.payer})).toString('base64');
   const body=canonical(paid.result);
   db.prepare('INSERT OR IGNORE INTO deliveries VALUES (?,?,?,?,?,?)').run(key,sale.principal,canonical(sale.offer),hash,body,paymentResponse);
   const delivered=db.prepare('SELECT * FROM deliveries WHERE operation=?').get(key) as any;
   respond(200,JSON.parse(delivered.body),{'PAYMENT-RESPONSE':delivered.payment_response});
  }catch(error){respond(409,{error:error instanceof Error?error.message:'request_failed'});}
 });
 server.on('close',()=>db.close());return server;
}
