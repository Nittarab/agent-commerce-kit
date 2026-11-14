import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Swarm } from './swarm.ts';

type Event = {id:number;at:string;type:string;principal?:string;step?:string;status?:string;message:string;transactionId?:string};
type Run={id:string|null;status:'idle'|'running'|'succeeded'|'failed';startedAt:string|null;events:Event[];error?:string;summary?:{newIssuances:number;balanceDeltaAtomic:string}};
export function snapshot(root:string){
 const path=join(root,'.local/testnet/payer.db');
 if(!existsSync(path))return {ready:false,orders:[],error:'No local purchases found. Open this dashboard from the configured private checkout.'};
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const config=db.prepare("SELECT value FROM config WHERE key='policy'").get() as {value:string}|undefined;
  if(!config)throw new Error('Policy missing');
  const policy=JSON.parse(config.value);
  const rows=db.prepare('SELECT id,principal,offer,payment,delivery,transaction_id,result,created_at FROM orders ORDER BY created_at').all() as any[];
  let committed=0n,settled=0n,held=0n;
  const orders=rows.map(row=>{
   const offer=JSON.parse(row.offer),amount=BigInt(offer.amountAtomic);
   if(['reserved','issued','pending','settled'].includes(row.payment)){committed+=amount;if(row.payment==='settled')settled+=amount;else held+=amount;}
   return {id:row.id,principalId:row.principal,operationId:offer.operationId,amountAtomic:offer.amountAtomic,paymentState:row.payment,deliveryState:row.delivery,transactionId:row.transaction_id??undefined,result:row.result?JSON.parse(row.result):undefined,createdAt:row.created_at};
  });
  const ready=['research-report','review-report'].every(id=>orders.some(o=>o.operationId===id&&o.paymentState==='settled'&&o.deliveryState==='delivered'))&&existsSync(join(root,'.local/testnet/accounts.json'));
  return {ready,orders,policy:{jobBudgetAtomic:policy.jobBudgetAtomic,asset:policy.asset,payer:policy.payer,network:policy.network,expiresAt:policy.expiresAt},budget:{committedAtomic:committed.toString(),settledAtomic:settled.toString(),heldAtomic:held.toString()},...(!ready?{error:'Replay is available only after both purchases have settled and their results are stored.'}:{})};
 }finally{db.close();}
}
export function safeEvent(input:unknown):Omit<Event,'id'>|undefined{
 if(!input||typeof input!=='object')return;
 const e=input as Record<string,unknown>;
 const steps=['session','approval','price','policy','payment','delivery','retry','budget'];
 if(typeof e.message!=='string'||e.message.length>350||typeof e.type!=='string'||!['progress','complete','refusal'].includes(e.type))return;
 return {at:new Date().toISOString(),type:e.type,message:e.message,
  ...(e.principal==='researcher'||e.principal==='reviewer'?{principal:e.principal}:{}),
  ...(typeof e.step==='string'&&steps.includes(e.step)?{step:e.step}:{}),
  ...(typeof e.status==='string'&&['started','complete','blocked','reused'].includes(e.status)?{status:e.status}:{}),
  ...(typeof e.transactionId==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(e.transactionId)?{transactionId:e.transactionId}:{})};
}
export function createDashboard(root:string,options:{launch?:()=>ChildProcess}={}){
 const token=randomBytes(32).toString('hex');
 const swarm=new Swarm(join(root,'.local/swarm'));
 let run:Run={id:null,status:'idle',startedAt:null,events:[]},child:ChildProcess|undefined;
 const assets=new Map([['/swarm-live.js',['apps/dashboard/public/swarm-live.js','text/javascript; charset=utf-8']],['/swarm-live.css',['apps/dashboard/public/swarm-live.css','text/css; charset=utf-8']],['/swarm',['apps/dashboard/public/swarm.html','text/html; charset=utf-8']],['/swarm.js',['apps/dashboard/public/swarm.js','text/javascript; charset=utf-8']],['/swarm.css',['apps/dashboard/public/swarm.css','text/css; charset=utf-8']],['/',['apps/dashboard/public/index.html','text/html; charset=utf-8']],['/app.js',['apps/dashboard/public/app.js','text/javascript; charset=utf-8']],['/style.css',['apps/dashboard/public/style.css','text/css; charset=utf-8']],['/guide',['docs/site/index.html','text/html; charset=utf-8']],['/evidence.json',['docs/site/evidence.json','application/json']]]);
 function start(){
  run={id:randomBytes(8).toString('hex'),status:'running',startedAt:new Date().toISOString(),events:[]};
  try{child=options.launch?options.launch():spawn(process.execPath,['apps/testnet/run.ts','--replay-only','--events'],{cwd:root,env:{...process.env,AGENT_KIT_DASHBOARD:'1'},stdio:['ignore','pipe','pipe']});}
  catch{run.status='failed';run.error='Could not start the replay process.';return;}
  const current=run,processChild=child;
  let buffer='',summary:Run['summary'];
  const timeout=setTimeout(()=>{current.status='failed';current.error='Replay timed out. Purchases remain unchanged. Inspect the runner lock before restarting.';processChild.kill('SIGTERM');},180000);
  processChild.stdout?.on('data',(data:Buffer)=>{
   buffer+=data.toString();if(buffer.length>65536){buffer='';return;}
   let i:number;while((i=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.startsWith('ACK_EVENT '))continue;
    try{const raw=JSON.parse(line.slice(10)),event=safeEvent(raw);if(event&&current.events.length<200)current.events.push({id:current.events.length+1,...event});
     if(raw.type==='complete'&&raw.newIssuances===0&&raw.balanceDeltaAtomic==='0')summary={newIssuances:0,balanceDeltaAtomic:raw.balanceDeltaAtomic};
    }catch{}
   }
  });
  // Never return raw child stderr (assertions and library errors may contain sensitive values).
  processChild.stderr?.resume();
  processChild.on('error',()=>{clearTimeout(timeout);current.status='failed';current.error='Replay process could not start. Check the local Node installation.';});
  processChild.on('close',code=>{clearTimeout(timeout);if(child===processChild)child=undefined;if(current.status==='failed')return;
   if(code===0&&summary){current.status='succeeded';current.summary=summary;}else{current.status='failed';current.error='Replay did not complete. No new payments were allowed. Check RPC connectivity, policy expiry, or an existing runner lock.';}
  });
 }
 const server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
  const address=server.address();const port=address&&typeof address==='object'?address.port:0;
  const hosts=['127.0.0.1:'+port,'localhost:'+port];
  const origin=req.headers.origin;
  const json=(status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(!hosts.includes(req.headers.host??'')||(origin!==undefined&&!hosts.some(host=>origin==='http://'+host))||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'Open the dashboard directly on this computer.'});
  if(req.method==='GET'&&req.url==='/api/swarm')return json(200,swarm.snapshot());
  if(req.method==='POST'&&req.url?.startsWith('/api/swarm/')){
   req.resume();
   if(req.headers['x-dashboard-token']!==token||!origin)return json(403,{error:'Reload the dashboard before controlling the swarm.'});
   try{
    const action=req.url.slice('/api/swarm/'.length);
    if(['start/market','start/budget','start/uncertain'].includes(action)){swarm.start(action.slice(6) as 'market'|'budget'|'uncertain');swarm.schedule();}
    else if(action==='pause')swarm.pause();
    else if(action==='resume')swarm.resume();
    else if(['speed/1','speed/3','speed/6'].includes(action))swarm.setSpeed(Number(action.slice(6)));
    else return json(404,{error:'Unknown swarm action.'});
    return json(200,swarm.snapshot());
   }catch{return json(409,{error:'Cannot start this scenario while a run is active. Finish or resume the current run.'});}
  }
  if(req.method==='GET'&&req.url==='/api/state'){
   try{return json(200,{...snapshot(root),run});}catch{return json(200,{ready:false,orders:[],error:'Local payment records could not be read. They were not changed.',run});}
  }
  if(req.method==='POST'&&req.url==='/api/run'){
   if(req.headers['x-dashboard-token']!==token||!origin)return json(403,{error:'Reload the dashboard before starting a replay.'});
   req.resume();
   if(child||run.status==='running')return json(409,{error:'A replay is already running.'});
   try{if(!snapshot(root).ready)return json(409,{error:'Both paid results must exist before replay. This dashboard cannot create new payments.'});}catch{return json(409,{error:'Payment records unavailable.'});}
   start();return json(202,{runId:run.id});
  }
  const asset=assets.get(req.url??'');if(req.method!=='GET'||!asset)return json(404,{error:'not_found'});
  try{let content=readFileSync(join(root,asset[0]),'utf8');
   if(req.url==='/'||req.url==='/swarm')content=content.replace('__DASHBOARD_TOKEN__',token);
   if(req.url!=='/guide')res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
   res.writeHead(200,{'content-type':asset[1]});res.end(content);
  }catch{return json(404,{error:'asset_missing'});}
 });
 server.on('close',()=>{swarm.dispose();if(child)child.kill('SIGTERM');});
 return server;
}
const root=fileURLToPath(new URL('../../',import.meta.url));
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createDashboard(root);server.listen(8787,'127.0.0.1',()=>console.log('Agent Commerce dashboard: http://127.0.0.1:8787'));
}
