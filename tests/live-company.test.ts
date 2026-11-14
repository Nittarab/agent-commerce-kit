import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { generateKeyPairSync,randomUUID } from 'node:crypto';
import { createCompany } from '../apps/testnet/company.ts';
import { localRequest } from '../apps/testnet/https.ts';
import { createSessionSigner,createApprovalHeader,operationFingerprint } from '../packages/poppy/index.ts';
import { operationFor,assertApiDiscovery } from '../packages/poppy/live.ts';
import { decodePaymentRequired,selectExactRequirement } from '../packages/x402/index.ts';
import { canonical } from '../packages/core/index.ts';
import { offer } from './fixtures.ts';

async function setup(t:test.TestContext){
 const dir=mkdtempSync(join(tmpdir(),'company-tls-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 const tmp=netServer();tmp.listen(0,'127.0.0.1');await once(tmp,'listening');const port=(tmp.address() as AddressInfo).port;await new Promise<void>(r=>tmp.close(()=>r()));
 const origin='https://localhost:'+port,issuer=origin+'/agent.json';let now=Math.floor(Date.now()/1000),calls=0,fail=false;
 const terms=offer({origin,url:origin+'/api/report?operation=operation-1',asset:'wrap.testnet',expiresAt:new Date((now+30)*1000).toISOString()});
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),kid='unit-test',sid=randomUUID();
 const signer=createSessionSigner({iss:issuer,aud:origin,sub:'researcher'},{kid,privateKey:keys.privateKey},now,now+3600);
 const config={origin,issuer,tls:{key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))},database:join(dir,'company.db'),keys:[{...keys.publicKey.export({format:'jwk'}),kid}],sales:[{principal:'researcher',offer:terms}],now:()=>now,validatePayment:(_sale:unknown,payload:string)=>{assert.equal(payload,canonical({fixture:true}));},settle:async()=>{calls++;await new Promise(r=>setTimeout(r,5));if(fail)throw new Error('unknown fixture settlement');return {transactionId:'SIMULATED-unit-test',result:{simulation:true,value:'protected fixture report'}};}};
 let server=createCompany(config);server.listen(port,'127.0.0.1');await once(server,'listening');
 const close=()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));
 t.after(async()=>{await close();rmSync(dir,{recursive:true,force:true});});
 const headers=()=>({'Poppy-Version':'1.0','Poppy-Extensions':'"operations";v="3"','Poppy-Session':signer.signSession({iss:issuer,aud:origin,sub:'researcher',sid,request:{url:terms.url,method:'GET'},approvedRequests:[{url:terms.url,method:'GET'}],now})});
 const operation=operationFor(terms),approval=createApprovalHeader(operation,terms,{fingerprint:operationFingerprint(operation,terms),approver:'agent',reference:randomUUID(),approvedAt:now},'initial',now);
 const paidHeaders=()=>({...headers(),'Poppy-Approval':approval,'PAYMENT-SIGNATURE':Buffer.from(canonical({fixture:true})).toString('base64')});
 const http=(h:Record<string,string>,url=terms.url)=>localRequest(origin,config.tls.cert,url,h);
 return {origin,terms,config,headers,paidHeaders,approval,http,calls:()=>calls,advance:()=>{now+=60;},fail:(v:boolean)=>{fail=v;},restart:async()=>{await close();server=createCompany(config);server.listen(port,'127.0.0.1');await once(server,'listening');}};
}
test('real HTTPS Poppy API negotiates discovery/session/approval before x402 challenge; fixture settlement only',async t=>{
 const s=await setup(t);const discovery=await s.http({},s.origin+'/.well-known/poppy.json');assertApiDiscovery(discovery.json,s.origin);assert.equal(discovery.json.extensions.operations[0].endpoint,undefined);
 assert.equal((await s.http({})).json.error,'version_unsupported');
 const missing=await s.http({'Poppy-Version':'1.0'});assert.equal(missing.status,403);assert.equal(missing.json.error,'extension_required');
 const invalid=await s.http({'Poppy-Version':'1.0','Poppy-Extensions':'"operations";v="3"','Poppy-Session':'not-a-jwt'});assert.equal(invalid.status,400);assert.equal(invalid.json.error,'invalid_session');
 const noApproval=await s.http(s.headers());assert.equal(noApproval.status,403);assert.equal(noApproval.json.operation.operation_id,s.terms.operationId);
 const h=s.headers();await s.http(h);assert.equal((await s.http(h)).json.error,'invalid_session');
 const challenge=await s.http({...s.headers(),'Poppy-Approval':s.approval});selectExactRequirement(decodePaymentRequired(challenge.status,challenge.headers['payment-required']),s.terms,120);
 assert.equal((await s.http({...s.headers(),'Content-Length':'1'})).status,400);
 assert.equal((await s.http(s.headers(),s.terms.url+'&changed=1')).status,404);
 assert.equal(s.calls(),0);
});
test('concurrent duplicate paid requests and restart return identical protected body and receipt once',async t=>{
 const s=await setup(t);const [a,b]=await Promise.all([s.http(s.paidHeaders()),s.http(s.paidHeaders())]);
 assert.equal(a.status,200);assert.equal(b.text,a.text);assert.equal(b.headers['payment-response'],a.headers['payment-response']);assert.equal(s.calls(),1);
 await s.restart();s.advance();const c=await s.http(s.paidHeaders());assert.equal(c.text,a.text);assert.equal(s.calls(),1);
 const changed=await s.http({...s.paidHeaders(),'PAYMENT-SIGNATURE':Buffer.from('{"fixture":false}').toString('base64')});assert.equal(changed.status,409);assert.equal(s.calls(),1);
});
test('pending exact payment binding survives expiry; wrong payload and a new revision cannot replace it',async t=>{
 const s=await setup(t);s.fail(true);assert.equal((await s.http(s.paidHeaders())).status,409);
 await s.restart();s.advance();s.fail(false);assert.equal((await s.http(s.paidHeaders())).status,200);
 s.config.sales[0].offer={...s.terms,revision:'2'};await s.restart();
 assert.equal((await s.http(s.paidHeaders())).status,409);assert.equal(s.calls(),2);
});
test('duplicate supplier operation definitions are rejected before listening',async t=>{
 const s=await setup(t);assert.throws(()=>createCompany({...s.config,sales:[s.config.sales[0],s.config.sales[0]]}),/Duplicate/);
});
