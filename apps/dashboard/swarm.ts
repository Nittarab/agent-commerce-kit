import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Ledger } from '../../packages/ledger/index.ts';
import { FixtureSigner } from '../../packages/wallet/index.ts';
import { FixtureRail } from '../../packages/wallet/fixture-rail.ts';
import { sha256 } from '../../packages/core/index.ts';
import type { Offer, Policy } from '../../packages/core/index.ts';

export const swarmAgents=Array.from({length:12},(_,i)=>({id:'agent-'+i,name:['Scout','Analyst','Researcher','Writer','Reviewer','Planner','Indexer','Auditor','Curator','Translator','Monitor','Summarizer'][i]}));
export const swarmServices=[{id:'search',name:'Search',origin:'https://search.example',payTo:'search.testnet'},{id:'verify',name:'Verification',origin:'https://verify.example',payTo:'verify.testnet'},{id:'compute',name:'Compute',origin:'https://compute.example',payTo:'compute.testnet'}];
type Scenario='market'|'budget'|'uncertain';
type Activity={id:number;tick:number;agent:string;service:string;stage:string;message:string;amount:string;orderId?:string};
type Task={n:number;agent:string;service:string;offer:Offer;phase:number;orderId?:string};
/** Trusted local coordinator. All payments and service results are fixtures; no network or keys. */
export class Swarm {
 private ledger?:Ledger; private rail?:FixtureRail; private timer?:ReturnType<typeof setInterval>;
 private tasks:Task[]=[]; private events:Activity[]=[]; private issued=0; private attempted=0; private tickNumber=0;
 private status:'idle'|'running'|'paused'|'complete'|'failed'='idle'; private scenario:Scenario='market'; private speed=3; private runId:string|null=null;
 private counters={delivered:0,refused:0,retries:0}; private orders=new Map<string,{agent:string;id:string}>();
 private storageRoot:string|undefined;
 constructor(storageRoot?:string){this.storageRoot=storageRoot;}
 start(scenario:Scenario='market'){
  if(this.status==='running'||this.status==='paused')throw new Error('Finish this run before starting another.');
  if(!['market','budget','uncertain'].includes(scenario))throw new Error('Unknown scenario');
  this.dispose();this.runId=randomUUID();this.scenario=scenario;this.tickNumber=0;this.attempted=0;this.issued=0;this.tasks=[];this.events=[];this.orders.clear();this.counters={delivered:0,refused:0,retries:0};
  const expiresAt=new Date(Date.now()+86400000).toISOString();
  const policy:Policy={id:'swarm-fixture',version:'1',jobId:this.runId,network:'near:testnet',asset:'simulated.testnet',payer:'fixture.testnet',jobBudgetAtomic:scenario==='budget'?'60':'180',expiresAt,suppliers:swarmServices.map(s=>({id:s.id,origin:s.origin,payTo:s.payTo})),grants:swarmAgents.map(a=>({principalId:a.id,suppliers:swarmServices.map(s=>s.id),maxPerPurchaseAtomic:'12',maxTotalAtomic:'40',expiresAt}))};
  let db=':memory:';
  if(this.storageRoot){mkdirSync(this.storageRoot,{recursive:true,mode:0o700});db=join(this.storageRoot,this.runId+'.db');}
  this.ledger=new Ledger(db,policy);this.rail=new FixtureRail(db===':memory:'?db:db+'.fixture');this.status='running';
 }
 resume(){if(this.status==='paused')this.status='running';}
 pause(){if(this.status==='running')this.status='paused';}
 setSpeed(speed:number){if(![1,3,6].includes(speed))throw new Error('Invalid speed');this.speed=speed;if(this.timer)this.schedule();}
 schedule(){if(this.timer)clearInterval(this.timer);this.timer=setInterval(()=>{try{this.step();}catch{this.status='failed';}},1000/this.speed);this.timer.unref();}
 private emit(task:Task,stage:string,message:string){this.events.push({id:this.events.length+1,tick:this.tickNumber,agent:task.agent,service:task.service,stage,message,amount:task.offer.amountAtomic,...(task.orderId?{orderId:task.orderId}:{})});}
 step(){
  if(this.status!=='running'||!this.ledger||!this.rail)return;
  this.tickNumber++;
  if(this.attempted<48){const n=this.attempted++,agent=swarmAgents[n%12].id,service=swarmServices[(Math.floor(n/12)+n)%3];
   const offer:Offer={operationId:'request-'+n,revision:'1',jobId:this.ledger.policy.jobId,supplierId:service.id,origin:service.origin,method:'POST',url:service.origin+'/service',bodyHash:sha256('fixture-task-'+n),network:'near:testnet',asset:'simulated.testnet',payer:'fixture.testnet',payTo:n%13===12?'unapproved.testnet':service.payTo,amountAtomic:n%11===10?'20':String(3+(n%7)),expiresAt:this.ledger.policy.expiresAt};
   const task={n,agent,service:service.id,offer,phase:0};this.tasks.push(task);this.emit(task,'request','Requests '+service.name.toLowerCase());
  }
  for(const task of this.tasks){
   task.phase++;
   if(task.phase===3){const auth=this.ledger.authorize(task.agent,task.offer);if(!auth.order){this.counters.refused++;this.emit(task,'refused',auth.decision.explanation);task.phase=99;continue;}task.orderId=auth.order.id;this.orders.set(task.orderId,{agent:task.agent,id:task.orderId});this.emit(task,'reserved','Policy approved; shared budget reserved atomically');}
   if(task.phase===6&&task.orderId){
    // A shared signer stops behind an uncertain attempt. Retain reservations; never invent failure evidence.
    if([...this.orders.values()].some(o=>this.ledger!.get(o.agent,o.id).paymentState==='pending')){this.emit(task,'held','Shared signer blocked by an uncertain payment; budget stays held');task.phase=99;continue;}
    const signed=this.ledger.issue(task.agent,task.orderId,order=>{this.issued++;return new FixtureSigner().sign(order);});
    const unknown=this.scenario==='uncertain'&&task.n===4;
    const tx=this.rail.prepare(signed.order,signed.payload,unknown?'unknown':'success');
    const pending=this.ledger.submission(task.orderId,tx);this.ledger.reconcile(this.rail.inspect(pending)!);
    this.emit(task,unknown?'held':'settled',unknown?'Fixture outcome unknown; issued payment remains held':'Simulated transfer settled');
    if(unknown)task.phase=99;
   }
   if(task.phase===8&&task.orderId){this.ledger.deliver(task.agent,task.orderId,JSON.stringify({simulation:true,service:task.service,request:task.n,result:'Fixture '+task.service+' result for '+task.agent}));this.counters.delivered++;this.emit(task,'delivered','Fixture service returned its result');}
   if(task.phase===10&&task.orderId){if(task.n%4===0){const replay=this.ledger.authorize(task.agent,task.offer);if(replay.kind!=='replay')throw new Error('Expected exact replay');this.counters.retries++;this.emit(task,'replay','Exact retry reused the same order; no second issuance');}task.phase=99;}
  }
  this.tasks=this.tasks.filter(t=>t.phase<99);
  if(this.attempted===48&&this.tasks.length===0)this.status='complete';
 }
 snapshot(){
  let paid=0n,held=0n;
  const orders=[...this.orders.values()].map(o=>{const order=this.ledger!.get(o.agent,o.id);const amount=BigInt(order.offer.amountAtomic);if(order.paymentState==='settled')paid+=amount;else if(['reserved','issued','pending'].includes(order.paymentState))held+=amount;return {id:order.id,agent:order.principalId,service:order.offer.supplierId,amount:order.offer.amountAtomic,payment:order.paymentState,delivery:order.deliveryState,result:order.result?JSON.parse(order.result.text):null};});
  return {simulation:true,runId:this.runId,status:this.status,scenario:this.scenario,speed:this.speed,tick:this.tickNumber,agents:swarmAgents,services:swarmServices,attempted:this.attempted,limit:48,issued:this.issued,...this.counters,budget:{limit:this.ledger?.policy.jobBudgetAtomic??'180',paid:String(paid),held:String(held),committed:String(paid+held)},events:this.events,orders};
 }
 dispose(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.rail?.close();this.ledger?.close();this.rail=undefined;this.ledger=undefined;}
}
