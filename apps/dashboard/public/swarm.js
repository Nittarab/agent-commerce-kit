'use strict';
const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const token=document.querySelector('meta[name="dashboard-token"]').content;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const colors={request:'#78a7be',reserved:'#a4f3c4',settled:'#a4f3c4',delivered:'#a4f3c4',refused:'#fa9d91',held:'#e8c483',replay:'#b7b6f3'};
const agentPoints=new Map(),servicePoints=new Map(),nodeElements=new Map();
let feedSignature='',state=null,runId=null,lastEvent=0,selectedAgent=null,selectedEvent=null,busy=false,connected=false,requestVersion=0,lastFrame=performance.now(),particles=[];
function text(id,value){$(id).textContent=String(value);}
function element(tag,attrs={},content){const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));if(content!==undefined)node.textContent=content;return node;}
function html(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=String(content);return node;}
function name(id){return state?.agents.find(a=>a.id===id)?.name??id;}
function service(id){return state?.services.find(s=>s.id===id)?.name??id;}
function curved(from,to){return `M${from[0]},${from[1]} C${(from[0]+to[0])/2},${from[1]} ${(from[0]+to[0])/2},${to[1]} ${to[0]},${to[1]}`;}
function mapSetup(data){
 $('nodes').replaceChildren();$('paths').replaceChildren();agentPoints.clear();servicePoints.clear();nodeElements.clear();
 data.agents.forEach((agent,i)=>{
  const p=[70+Math.floor(i/4)*145,87+(i%4)*92];agentPoints.set(agent.id,p);
  const path=element('path',{d:curved([p[0]+20,p[1]],[514,218]),class:'wire','data-agent':agent.id});$('paths').append(path);
  const group=element('g',{class:'node',role:'button',tabindex:0,'aria-label':`Inspect ${agent.name}`,transform:`translate(${p[0]} ${p[1]})`});
  group.append(element('circle',{r:20}),element('text',{'text-anchor':'middle',y:4},String(i+1).padStart(2,'0')),element('text',{'text-anchor':'middle',y:38,class:'agent-name'},agent.name),element('text',{'text-anchor':'middle',y:51,class:'sub agent-status'},'READY'));
  const choose=()=>{selectedAgent=agent.id;selectedEvent=null;renderSelection();};group.addEventListener('click',choose);group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});$('nodes').append(group);nodeElements.set(agent.id,group);
 });
 data.services.forEach((supplier,i)=>{const p=[834,105+i*113];servicePoints.set(supplier.id,p);$('paths').append(element('path',{d:curved([616,218],[p[0]-30,p[1]]),class:'wire'}),element('path',{d:curved([p[0]+30,p[1]],[1010,220]),class:'wire'}));const group=element('g',{class:'service',transform:`translate(${p[0]} ${p[1]})`});group.append(element('circle',{r:30}),element('text',{'text-anchor':'middle',y:4},['⌕','✓','⟐'][i]),element('text',{'text-anchor':'middle',y:49},supplier.name));$('nodes').append(group);});
}
function animateEvent(event){
 if(!agentPoints.has(event.agent)||!servicePoints.has(event.service))return;
 const buyer=agentPoints.get(event.agent),supplier=servicePoints.get(event.service),gate=[565,218],ledger=[1055,220];
 let points=event.stage==='request'?[buyer,gate]:event.stage==='reserved'?[[514,218],[616,218]]:event.stage==='settled'?[gate,supplier,ledger]:event.stage==='delivered'?[supplier,gate,buyer]:event.stage==='refused'?[gate,[buyer[0],Math.min(405,buyer[1]+20)]]:event.stage==='replay'?[buyer,gate,supplier]:[gate,gate];
 const dot=element('circle',{r:event.stage==='held'?8:4.5,fill:colors[event.stage]??colors.request,opacity:.95});
 const halo=element('circle',{r:event.stage==='held'?16:10,fill:colors[event.stage]??colors.request,opacity:.12});
 $('particles').append(halo,dot);particles.push({dot,halo,points,elapsed:0,duration:event.stage==='held'?1800:Math.max(750,1900/(state?.speed??3)*2),static:reduced.matches||event.stage==='held'});
 while(particles.length>100){const old=particles.shift();old.dot.remove();old.halo.remove();}
}
function frame(now){
 const delta=Math.min(60,now-lastFrame);lastFrame=now;
 if(state?.status!=='paused'){
  particles=particles.filter(p=>{p.elapsed+=delta;const t=Math.min(1,p.elapsed/p.duration);const step=t*(p.points.length-1),index=Math.min(p.points.length-2,Math.floor(step)),u=step-index;const a=p.points[index],b=p.points[index+1];const position=p.static?p.points.at(-1):[a[0]+(b[0]-a[0])*(u*u*(3-2*u)),a[1]+(b[1]-a[1])*u];for(const node of[p.dot,p.halo]){node.setAttribute('cx',position[0]);node.setAttribute('cy',position[1]);}p.dot.setAttribute('opacity',p.static?1-t:.95);if(t===1){p.dot.remove();p.halo.remove();return false;}return true;});
 }
 requestAnimationFrame(frame);
}
function renderFeed(){
 if(!state)return;const filter=$('filter').value;
 const signature=[state.runId,state.events.at(-1)?.id,filter,selectedAgent,selectedEvent].join('|');if(signature===feedSignature)return;feedSignature=signature;
 const events=state.events.filter(e=>(filter==='all'||e.stage===filter)&&(!selectedAgent||e.agent===selectedAgent)).slice(-60).reverse();
 const fragment=document.createDocumentFragment();
 for(const event of events){const row=html('tr',selectedEvent===event.id?'selected':'');const tick=html('td','',String(event.tick).padStart(3,'0'));const who=html('td');const button=html('button','',`${name(event.agent)} → ${service(event.service)}`);button.setAttribute('aria-label',`Inspect ${name(event.agent)} ${event.stage} at tick ${event.tick}`);button.addEventListener('click',()=>{selectedEvent=event.id;renderSelection();});who.append(button,html('small','',event.message));const decision=html('td');decision.append(html('span','tag '+event.stage,event.stage));row.append(tick,who,decision,html('td','',event.amount));row.addEventListener('click',eventObject=>{if(eventObject.target!==button){selectedEvent=event.id;renderSelection();}});fragment.append(row);}
 $('feed').replaceChildren(fragment);$('empty').hidden=events.length>0; if(!events.length)text('empty',state.events.length?'No activity matches this selection.':'No events yet. Every row will come from the running controller.');
}
function addFacts(values){const dl=html('dl');for(const [label,value]of values){dl.append(html('dt','',label),html('dd','',value));}$('detail').append(dl);}
function renderSelection(){
 if(!state)return;
 for(const [id,node]of nodeElements){node.classList.toggle('selected',id===selectedAgent);node.setAttribute('aria-pressed',String(id===selectedAgent));}
 for(const path of $('paths').querySelectorAll('[data-agent]'))path.setAttribute('stroke-opacity',!selectedAgent||path.getAttribute('data-agent')===selectedAgent?'1':'.2');
 $('detail').replaceChildren();$('clear').hidden=!selectedAgent&&!selectedEvent;
 const event=state.events.find(e=>e.id===selectedEvent);
 if(event){text('detail-title',`${name(event.agent)} · ${event.stage}`);text('detail-copy',event.message);const order=state.orders.find(o=>o.id===event.orderId);addFacts([['Mode','SIMULATION'],['Observed','Tick '+event.tick],['Service',service(event.service)],['Amount',event.amount+' synthetic units'],['Order',event.orderId??'No order issued'],['Payment',order?.payment??'Not authorized'],['Delivery',order?.delivery??'No result']]);if(order?.result){$('detail').append(html('pre','',JSON.stringify(order.result,null,2)));}}
 else if(selectedAgent){text('detail-title',name(selectedAgent));const events=state.events.filter(e=>e.agent===selectedAgent),orders=state.orders.filter(o=>o.agent===selectedAgent);const committed=orders.filter(o=>['reserved','issued','pending','settled'].includes(o.payment)).reduce((n,o)=>n+BigInt(o.amount),0n);text('detail-copy','Scripted buyer · fixture services only. The transaction stream is filtered to this agent.');addFacts([['Budget',`${committed} / 40 synthetic units`],['Purchases',orders.length],['Delivered',orders.filter(o=>o.delivery==='delivered').length],['Refused',events.filter(e=>e.stage==='refused').length],['Latest',events.at(-1)?.message??'Waiting for its first request']]);}
 else{text('detail-title','Inside the swarm');text('detail-copy','Select any agent on the map or a transaction below to inspect its activity.');if(state.runId)addFacts([['Mode','SIMULATION'],['Run scope','New runs use separate ledgers; earlier holds remain in their original ledger.'],['Run',state.runId],['Issuances',state.issued+' simulated'],['Holds',state.budget.held+' synthetic units'],['Progress',`${state.attempted} / ${state.limit} requests`]]);}
 renderFeed();
}
function render(data,{animate=true}={}){
 if(data.simulation!==true||!Array.isArray(data.events))throw new Error('Unexpected swarm response');
 const changed=data.runId!==runId;state=data;
 if(changed||!nodeElements.size){runId=data.runId;lastEvent=0;selectedAgent=null;selectedEvent=null;for(const p of particles){p.dot.remove();p.halo.remove();}particles=[];mapSetup(data);}
 const unseen=data.events.filter(e=>e.id>lastEvent);
 // Existing history is rendered as recorded state; only newly observed events animate.
 if(animate)for(const event of unseen)animateEvent(event);
 lastEvent=data.events.at(-1)?.id??0;
 const active=['running','paused'].includes(data.status);
 $('start').disabled=busy||active||!connected;$('scenario').disabled=busy||active;$('pause').disabled=busy||!active||!connected;$('speed').disabled=busy||!connected;
 text('start',data.runId?'New isolated run ↗':'Start swarm ↗');text('pause',data.status==='paused'?'Resume':'Pause');
 if(active)$('scenario').value=data.scenario;$('speed').value=String(data.speed);
 text('status',({idle:'Ready to run',running:'Running',paused:'Paused — holds retained',complete:BigInt(data.budget.held)>0n?'Scenario ended — holds retained':'Scenario complete',failed:'Controller stopped — holds retained'})[data.status]+(data.tick?' · tick '+data.tick:''));
 text('attempted',data.attempted);text('delivered',data.delivered);text('refused',data.refused);text('retries',data.retries);
 const limit=BigInt(data.budget.limit),paid=BigInt(data.budget.paid),held=BigInt(data.budget.held),left=limit-paid-held;
 text('budget-label',`${paid+held} / ${limit}`);text('paid',`${paid} paid`);text('held',`${held} held`);text('left',`${left} left`);
 $('paid-bar').style.width=Number(paid*10000n/limit)/100+'%';$('held-bar').style.width=Number(held*10000n/limit)/100+'%';
 for(const [id,node]of nodeElements){const latest=data.events.findLast(e=>e.agent===id);const circle=node.querySelector('circle');circle.style.stroke=latest?colors[latest.stage]:'#4c6b5a';node.querySelector('.agent-status').textContent=latest?.stage.toUpperCase()??'READY';}
 const latest=data.events.at(-1);text('map-caption',latest?`${name(latest.agent)} · ${latest.message}`:'Start a scenario to see events from the local controller.');
 renderSelection();
}
function showError(message){text('error',message);$('error').hidden=false;}
async function action(path){
 if(busy)return;busy=true;const version=++requestVersion;if(state)render(state,{animate:false});
 try{const response=await fetch('/api/swarm/'+path,{method:'POST',headers:{'x-dashboard-token':token}});const data=await response.json();if(!response.ok)throw new Error(data.error??'Could not update the swarm.');connected=true;busy=false;$('error').hidden=true;render(data);}
 catch(error){showError(error.message);}
 finally{busy=false;if(state)render(state,{animate:false});}
}
async function poll(){
 if(!busy){const version=requestVersion;
  try{const response=await fetch('/api/swarm',{cache:'no-store'});if(!response.ok)throw new Error('Controller unavailable');const data=await response.json();if(version===requestVersion&&!busy){const first=!connected;connected=true;$('error').hidden=true;render(data,{animate:!first});}}
  catch{connected=false;showError('Local controller disconnected. Start the dashboard server, then reload. No successful transactions are inferred.');$('start').disabled=true;$('pause').disabled=true;$('speed').disabled=true;text('status','Disconnected');}
 }
 setTimeout(poll,400);
}
$('start').addEventListener('click',()=>action('start/'+$('scenario').value));
$('pause').addEventListener('click',()=>action(state?.status==='paused'?'resume':'pause'));
$('speed').addEventListener('change',()=>action('speed/'+$('speed').value));
$('filter').addEventListener('change',renderFeed);
$('clear').addEventListener('click',()=>{selectedAgent=null;selectedEvent=null;renderSelection();});
requestAnimationFrame(frame);poll();
