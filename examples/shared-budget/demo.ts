import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes,generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ControlClient,runAgent } from '../../packages/agent/index.ts';
import { sha256 } from '../../packages/core/index.ts';
import type { Offer } from '../../packages/core/index.ts';
import { validateDiscovery,createSessionSigner,verifySession } from '../../packages/poppy/index.ts';
import { decodePaymentRequired,selectExactRequirement } from '../../packages/x402/index.ts';

console.log('SIMULATION — no NEAR transaction, live model or external supplier is called.');
const dir=mkdtempSync(join(tmpdir(),'agent-commerce-demo-'));
const researcherToken=randomBytes(32).toString('hex'),reviewerToken=randomBytes(32).toString('hex');
const child=spawn(process.execPath,[fileURLToPath(new URL('../../apps/control/main.ts',import.meta.url)),join(dir,'ledger.db'),fileURLToPath(new URL('../../policies/demo.json',import.meta.url))],{stdio:['ignore','pipe','pipe'],env:{...process.env,AGENT_KIT_MODE:'simulation',AGENT_KIT_AUTH:JSON.stringify({ownerToken:randomBytes(32).toString('hex'),actors:[[researcherToken,'researcher'],[reviewerToken,'reviewer']]}),AGENT_KIT_SIMULATION_FAULTS:JSON.stringify([['research','lost_response']])}});
let errors='';child.stderr.on('data',chunk=>errors+=chunk);
try {
 const base=await new Promise<string>((resolve,reject)=>{const lines=createInterface({input:child.stdout});const timeout=setTimeout(()=>reject(new Error('Control startup timeout: '+errors)),10000);lines.once('line',line=>{clearTimeout(timeout);lines.close();resolve(JSON.parse(line).url);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Control exited '+code+': '+errors));});child.once('error',reject);});
 const supplier='https://supplier.example',endpoint=supplier+'/conversations';
 validateDiscovery({protocol_version:'1.0',organization:{name:'Fixture supplier',domain:'supplier.example'},agent:{protocols:[{type:'poppy',endpoint,description:'Synthetic data and checking',access:'session'}]}},supplier+'/.well-known/poppy.json',{companyOrigin:supplier,conversationEndpoint:endpoint,noOAuthIssuer:true});
 for(const actor of ['researcher','reviewer']){
  const issuer=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),keys=[{...issuer.publicKey.export({format:'jwk'}),kid:actor}];
  const now=Math.floor(Date.now()/1000),request={method:'POST',url:endpoint};
  const context={iss:'https://'+actor+'.example/client.json',aud:supplier,sub:'fixture-user-'+actor,sid:'session-'+actor,now,request,approvedRequests:[request]};
  const signer=createSessionSigner({iss:context.iss,aud:context.aud,sub:context.sub},{kid:actor,privateKey:issuer.privateKey},now,now+120);
  verifySession(signer.signSession(context),context,keys);
 }
 console.log('Poppy fixture: discovery validated; two distinct signed-out ES256 sessions verified locally.');
 const makeOffer=(operationId:string,amountAtomic:string,body:string):Offer=>({operationId,revision:'1',jobId:'demo-job',supplierId:'fixture-supplier',origin:supplier,method:'POST',url:supplier+'/'+operationId,bodyHash:sha256(body),network:'near:testnet',asset:'demo-token.testnet',payer:'buyer.testnet',payTo:'supplier.testnet',amountAtomic,expiresAt:'2029-01-01T00:00:00Z'});
 function validateChallenge(offer:Offer){const challenge={x402Version:2,resource:{url:offer.url},accepts:[{scheme:'exact',network:offer.network,asset:offer.asset,payTo:offer.payTo,amount:offer.amountAtomic,maxTimeoutSeconds:60}]};selectExactRequirement(decodePaymentRequired(402,Buffer.from(JSON.stringify(challenge)).toString('base64')),offer,60);}
 const researcher=new ControlClient(base,researcherToken),reviewer=new ControlClient(base,reviewerToken);
 const researchOffer=makeOffer('research','60','{}');validateChallenge(researchOffer);
 let step=0;
 const work=await runAgent({next:async history=>step++===0?{type:'tool',name:'buy',input:researchOffer}:{type:'done',output:history.at(-1)}},{buy:async(input,signal)=>{try{return await researcher.purchase(input as Offer,signal);}catch{signal.throwIfAborted();return await researcher.purchase(input as Offer,signal);}}},{maxSteps:3,timeoutMs:15000});
 const research=(work.output as {result:Awaited<ReturnType<ControlClient['purchase']>>}).result;
 if(research.order?.deliveryState!=='delivered')throw new Error('Research delivery failed');
 console.log('Researcher: paid 60 simulated units; lost response recovered under the same order.');
 const artifact=research.order.result!;const checkOffer=makeOffer('review','30',JSON.stringify({artifactDigest:artifact.digest}));validateChallenge(checkOffer);
 const review=await reviewer.purchase(checkOffer);if(review.order?.deliveryState!=='delivered')throw new Error('Review delivery failed');
 const facts=JSON.parse(artifact.text).facts,checkFacts=JSON.parse(review.order.result!.text).facts;
 if(sha256(artifact.text)!==artifact.digest||JSON.stringify(facts)!==JSON.stringify(checkFacts))throw new Error('Artifact verification failed');
 console.log('Reviewer: paid 30 simulated units; independently checked the exact artifact against the fixture.');
 const refused=await reviewer.purchase(makeOffer('extra','20','{}'));
 if(refused.order)throw new Error('Expected spending refusal');
 console.log('Extra 20-unit request: REFUSED ('+refused.decision?.code+').');
 const budget=await researcher.budget();console.log('Shared committed budget: '+budget.jobCommittedAtomic+' / 100.');
 console.log('Two buying agents, one fixture supplier. Same provider; no independent-provider claim.');
 console.log('PASS — payment controls and recovery simulated. This fixture run does not verify live settlement; use testnet:run for the separate live path.');
} finally {
 if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);timer.unref();})]);}
 rmSync(dir,{recursive:true,force:true});
}
