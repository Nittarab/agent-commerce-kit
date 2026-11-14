'use strict';
// This panel reads the live integration's safe projection. It never handles a key or payment payload.
{
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const panel=el('section',null,'live-integration');panel.id='near-integration';
 const heading=el('div',null,'section-heading');heading.append(el('h2','NEAR testnet · the working payment stack'));
 const button=el('button','Replay existing purchases ↗','primary');button.disabled=true;heading.append(button);panel.append(heading);
 panel.append(el('p','The swarm above is simulated. This separate integration uses our NEAR wallet, local HTTPS supplier and embedded facilitator. Replay retrieves the two paid results without signing or paying again.'));
 const status=el('p','Checking local testnet configuration…','live-status');status.setAttribute('role','status');panel.append(status);
 const components=el('div',null,'stack-cards');
 const cards=[['01 / POPPY','Identity + approval','Signed sessions and exact operation approval bind the agent to a service request.'],['02 / X402','Exact payment terms','The API names its token, recipient and price. The client checks all three.'],['03 / WALLET','Reserve, then sign','The host saves one exact NEAR payment authorization. Keys stay outside agents and browser.'],['04 / FACILITATOR','Verify + relay','Our embedded facilitator verifies the delegate and persists the relay transaction before broadcast.'],['05 / NEAR','Settlement + result','The original transfers verified final inner receipts. Replay returns saved receipts and reports.']];
 for(const [label,title,copy]of cards){const card=el('article');card.append(el('div',label,'eyebrow'),el('h3',title),el('p',copy));components.append(card);}panel.append(components);
 const proof=el('div',null,'live-proof');panel.append(proof);
 const explanation=el('details');explanation.append(el('summary','Run this on your machine'));const commands=el('pre','npm ci --ignore-scripts\nnpm start\n\n# Optional: create testnet wallets and execute the two test purchases\nnpm run demo:testnet');explanation.append(commands,el('p','npm start needs no keys and makes no network payments. The optional testnet command uses faucet tokens and local keys. On a completed setup it replays saved purchases. It stops for uncertain or incomplete payment records.'));panel.append(explanation);
 const detailLink=el('a','Inspect the NEAR reports and full protocol trace ↗');detailLink.href='/';panel.append(detailLink);
 document.querySelector('.below').before(panel);
 let running=false;
 async function refresh(){try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();running=data.run?.status==='running';button.disabled=!data.ready||running;button.textContent=running?'Retrieving paid results…':'Replay existing purchases ↗';proof.replaceChildren();
  if(!data.ready){status.textContent='Testnet wallet not ready in this checkout. The swarm works independently; expand local setup below to enable the live integration.';}
  else{status.textContent=running?'Live HTTPS requests running; saved payment authorizations reused.':data.run?.status==='succeeded'?'Replay complete: 0 new payments. Recorded settlement receipts and results retrieved.':data.run?.status==='failed'?'Replay stopped. No new payments were allowed; existing holds remain.':'Two paid testnet purchases are available. Supplier and facilitator start only during a run.';
   const wallet=el('p','Wallet: '+data.policy.payer+' · '+data.policy.network);proof.append(wallet);
   for(const order of data.orders.filter(o=>o.transactionId)){const row=el('div',null,'receipt');const title=el('strong',order.principalId+' → report supplier');const link=el('a','View recorded NEAR transfer ↗');link.href='https://testnet.nearblocks.io/txns/'+encodeURIComponent(order.transactionId);link.target='_blank';link.rel='noopener noreferrer';row.append(title,el('span',order.paymentState+' · '+order.deliveryState),link);proof.append(row);}
  }
 }catch{button.disabled=true;status.textContent='Local controller unavailable. Restart npm start; no payment status is inferred.';}
 setTimeout(refresh,running?600:2500);}
 button.addEventListener('click',async()=>{button.disabled=true;try{const response=await fetch('/api/run',{method:'POST',headers:{'x-dashboard-token':document.querySelector('meta[name="dashboard-token"]').content}});if(!response.ok)throw new Error();status.textContent='Starting real protocol retrieval. New payments are disabled.';}catch{status.textContent='Could not start replay. Check configuration or an active run.';}});
 refresh();
}
