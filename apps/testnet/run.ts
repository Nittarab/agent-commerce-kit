import { KeyPair } from 'near-api-js';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync,mkdirSync,rmSync,chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { Ledger } from '../../packages/ledger/index.ts';
import type { Offer,Policy } from '../../packages/core/index.ts';
import { canonical,sha256 } from '../../packages/core/index.ts';
import { createSessionSigner,createApprovalHeader,operationFingerprint } from '../../packages/poppy/index.ts';
import { assertApiDiscovery,assertOperation } from '../../packages/poppy/live.ts';
import { decodePaymentRequired,selectExactRequirement } from '../../packages/x402/index.ts';
import { TestnetRail,assertTestnet,preparePayer,checkPayment,rpc,view,TOKEN,TIMEOUT } from '../../packages/near/testnet.ts';
import { createCompany } from './company.ts';
import { localRequest } from './https.ts';

const dir='.local/testnet', origin='https://localhost:9443', issuer=origin+'/agent.json';
if(!existsSync(dir+'/accounts.json'))throw new Error('Run npm run testnet:setup first');
const lock=dir+'/running.lock';
try{writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch{throw new Error('A live runner lock exists. Stop the existing runner; after a crash verify its PID is dead before removing .local/testnet/running.lock.');}
let cleanup=()=>{};
try{
 await assertTestnet();
 const config=JSON.parse(readFileSync(dir+'/accounts.json','utf8'));
 if(config.network!=='testnet')throw new Error('Testnet only');
 if(!existsSync(dir+'/tls-key.pem')){
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/tls-key.pem','-out',dir+'/tls-cert.pem','-days','30','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
  chmodSync(dir+'/tls-key.pem',0o600);
 }
 const tls={key:readFileSync(dir+'/tls-key.pem'),cert:readFileSync(dir+'/tls-cert.pem')};
 if(!existsSync(dir+'/policy.json')){
  const expiresAt=new Date(Date.now()+7*86400000).toISOString();
  const policy:Policy={id:'testnet-live',version:'1',jobId:'live-job-v1',network:'near:testnet',asset:TOKEN,payer:config.payer.accountId,jobBudgetAtomic:'2000000000000000000',expiresAt,suppliers:[{id:'private-supplier',origin,payTo:config.merchant.accountId}],grants:[{principalId:'researcher',suppliers:['private-supplier'],maxPerPurchaseAtomic:'1000000000000000000',maxTotalAtomic:'2000000000000000000',expiresAt},{principalId:'reviewer',suppliers:['private-supplier'],maxPerPurchaseAtomic:'1000000000000000000',maxTotalAtomic:'1000000000000000000',expiresAt}]};
  writeFileSync(dir+'/policy.json',JSON.stringify(policy,null,2),{flag:'wx',mode:0o600});
 }
 const policy:Policy=JSON.parse(readFileSync(dir+'/policy.json','utf8'));
 const ledger=new Ledger(dir+'/payer.db',policy),payerKey=KeyPair.fromString(config.payer.privateKey);
 const rail=new TestnetRail(dir+'/facilitator.db',config.relayer.accountId,config.relayer.privateKey,payerKey.getPublicKey().toString());
 const offer=(operationId:string):Offer=>({operationId,revision:'1',jobId:policy.jobId,supplierId:'private-supplier',origin,url:origin+'/api/report?operation='+operationId,method:'GET',bodyHash:sha256(''),network:'near:testnet',asset:TOKEN,payer:policy.payer,payTo:config.merchant.accountId,amountAtomic:'1000000000000000000',expiresAt:policy.expiresAt});
 const sales=[{principal:'researcher',offer:offer('research-report')},{principal:'reviewer',offer:offer('review-report')}];
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),kid='testnet-issuer';
 const publicKeys=[{...keys.publicKey.export({format:'jwk'}),kid}];
 const initialBalance=BigInt(await view('ft_balance_of',{account_id:config.merchant.accountId}));
 const startOrders=sales.map(s=>ledger.lookup(s.principal,s.offer));
 const startedUnresolved=startOrders.some(o=>o&&['issued','pending'].includes(o.paymentState));
 const settledBefore=startOrders.filter(o=>o?.paymentState==='settled').length;
 const beforeIssuances=ledger.audit().filter(e=>JSON.parse(e.event).type==='issued').length;
 const company=createCompany({origin,tls,database:dir+'/company.db',issuer,keys:publicKeys,sales,validatePayment:(sale,payload)=>{
  const order=ledger.lookup(sale.principal,sale.offer);
  if(!order||!['issued','pending','settled'].includes(order.paymentState)||order.payloadHash!==sha256(payload))throw new Error('No exact issued authorized purchase');
  checkPayment(JSON.parse(payload),sale.offer,payerKey.getPublicKey().toString());
 },settle:async(sale,payload)=>{
  const order=ledger.lookup(sale.principal,sale.offer)!;
  const result=await rail.settle(order,payload);
  const evidence=rail.evidence(order,payload,result);
  if(order.paymentState==='issued')ledger.submission(order.id,evidence.transactionId);
  ledger.reconcile(evidence);
  if(evidence.outcome!=='success'||!evidence.final)throw new Error('Payment pending: keep the hold and retry the same purchase');
  const report={network:'near:testnet',service:'Finalized block report',transactionId:evidence.transactionId,transferReceipt:result.receipts_outcome.filter((r:any)=>r.outcome.executor_id===TOKEN).map((r:any)=>({id:r.id,blockHash:r.block_hash,status:r.outcome.status})),checkedAt:new Date().toISOString()};
  return {transactionId:evidence.transactionId,result:report};
 }});
 cleanup=()=>{company.close();rail.close();ledger.close();};
 company.listen(9443,'127.0.0.1');await once(company,'listening');
 const http=(url:string,headers?:Record<string,string>)=>localRequest(origin,tls.cert,url,headers);
 const discovery=await http(origin+'/.well-known/poppy.json');assert.equal(discovery.status,200);assertApiDiscovery(discovery.json,origin);
 const api=await http(discovery.json.apis[0].url);assert.ok(api.json.paths['/api/report'].get);
 const metadata=await http(issuer);assert.equal(metadata.json.client_id,issuer);assert.equal(metadata.json.jwks_uri,origin+'/jwks.json');
 const jwks=await http(metadata.json.jwks_uri);assert.deepEqual(jwks.json.keys,publicKeys);
 const transactions:string[]=[];
 for(const sale of sales){
  const now=Math.floor(Date.now()/1000),signer=createSessionSigner({iss:issuer,aud:origin,sub:sale.principal},{kid,privateKey:keys.privateKey},now,now+3600),sid=randomUUID();
  const headers=()=>({'Poppy-Version':'1.0','Poppy-Extensions':'"operations";v="3"','Poppy-Session':signer.signSession({iss:issuer,aud:origin,sub:sale.principal,sid,request:{url:sale.offer.url,method:'GET'},approvedRequests:sales.map(s=>({url:s.offer.url,method:'GET'})),now:Math.floor(Date.now()/1000)})});
  const first=await http(sale.offer.url,headers());assert.equal(first.status,403);
  const operation=assertOperation(first.json.operation,sale.offer);
  const approvalPath=dir+'/'+sale.offer.operationId+'-approval.json';
  const approval=existsSync(approvalPath)?JSON.parse(readFileSync(approvalPath,'utf8')).header:createApprovalHeader(operation,sale.offer,{fingerprint:operationFingerprint(operation,sale.offer),approver:'agent',reference:randomUUID(),approvedAt:now},'initial',now);
  if(!existsSync(approvalPath))writeFileSync(approvalPath,JSON.stringify({header:approval}),{mode:0o600,flag:'wx'});
  const challenge=await http(sale.offer.url,{...headers(),'Poppy-Approval':approval});
  selectExactRequirement(decodePaymentRequired(challenge.status,challenge.headers['payment-required']),sale.offer,TIMEOUT);
  const auth=ledger.authorize(sale.principal,sale.offer);if(!auth.order)throw new Error(auth.decision.explanation);
  const build=auth.order.payloadHash?()=>{throw new Error('Existing issuance must be reused');}:await preparePayer(sale.offer,payerKey);
  const issued=ledger.issue(sale.principal,auth.order.id,build);
  const request=()=>http(sale.offer.url,{...headers(),'Poppy-Approval':approval,'PAYMENT-SIGNATURE':Buffer.from(issued.payload).toString('base64')});
  const paid=await request();if(paid.status!==200)throw new Error('Supplier: '+JSON.stringify(paid.json));
  const receipt=JSON.parse(Buffer.from(String(paid.headers['payment-response']),'base64').toString());
  assert.equal(receipt.success,true);assert.equal(receipt.network,'near:testnet');assert.equal(receipt.payer,sale.offer.payer);
  const replay=await request();assert.equal(replay.status,200);assert.equal(replay.text,paid.text);assert.equal(replay.headers['payment-response'],paid.headers['payment-response']);
  ledger.deliver(sale.principal,auth.order.id,paid.text);transactions.push(receipt.transaction);
  console.log(sale.principal+': FINAL transfer, protected result delivered, exact retry unchanged. Transaction '+receipt.transaction);
 }
 const refused=ledger.authorize('researcher',offer('over-budget'));
 assert.equal(refused.kind,'denied');
 if(Date.now()<Date.parse(policy.expiresAt))assert.equal(refused.decision.code,'job_budget_exceeded');
 const finalBalance=BigInt(await view('ft_balance_of',{account_id:config.merchant.accountId}));
 const afterIssuances=ledger.audit().filter(e=>JSON.parse(e.event).type==='issued').length;
 const expectedDelta=BigInt(sales.length-settledBefore)*1000000000000000000n;
 // An attempt unresolved at startup can settle before either balance read. Its FINAL receipts are the proof.
 if(!startedUnresolved)assert.equal(finalBalance-initialBalance,expectedDelta);
 const proof={accounts:{payer:config.payer.accountId,recipient:config.merchant.accountId,relayer:config.relayer.accountId},network:'near:testnet',asset:TOKEN,amountPerPurchaseAtomic:'1000000000000000000',transactions,verifiedAt:new Date().toISOString(),recipientBalanceDeltaAtomic:(finalBalance-initialBalance).toString(),newIssuances:afterIssuances-beforeIssuances,balanceCheck:startedUnresolved?'Unresolved at startup; use correlated FINAL receipts':'Exact balance delta verified',repeatRetrieval:'same response; no new transfer',additionalPurchaseRefusal:refused.decision.code};
 const old=existsSync('docs/testnet-evidence.json')?JSON.parse(readFileSync('docs/testnet-evidence.json','utf8')):null;
 const previousObservations=old?(old.observations??[{verifiedAt:old.verifiedAt,recipientBalanceDeltaAtomic:old.recipientBalanceDeltaAtomic,newIssuances:old.newIssuances,balanceCheck:old.balanceCheck}]):[];
 const evidence={...proof,observations:[...previousObservations,{verifiedAt:proof.verifiedAt,recipientBalanceDeltaAtomic:proof.recipientBalanceDeltaAtomic,newIssuances:proof.newIssuances,balanceCheck:proof.balanceCheck}]};
 writeFileSync(dir+'/proof.json',JSON.stringify(evidence,null,2),{mode:0o600});
 writeFileSync('docs/testnet-evidence.json',JSON.stringify(evidence,null,2));
 writeFileSync('docs/site/evidence.json',JSON.stringify({title:'Real testnet transfers confirmed',detail:'Two Poppy-approved purchases completed through HTTPS x402 payments and FINAL NEAR testnet token-transfer receipts. Exact retries returned the same result. An extra purchase was refused ('+refused.decision.code+').',transactions},null,2));
 console.log('PASS: live Poppy API + x402 + NEAR testnet. Observed recipient balance delta: '+(finalBalance-initialBalance)+' atomic wrapped test-token units.');
} finally {cleanup();rmSync(lock,{force:true});}
