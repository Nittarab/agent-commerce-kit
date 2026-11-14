'use strict';
const $ = (id) => document.getElementById(id);
const TOKEN = document.querySelector('meta[name="dashboard-token"]')?.content;
const MICRO = 10n ** 18n;
let currentState = null, selectedId = null, connected = false, submitting = false, timer = null;
let lastRunId = null, lastEvents = '', actionError = '', refreshSerial = 0;
const names = { researcher: 'Researcher', reviewer: 'Reviewer' };
const roles = { researcher: 'Buys the first report', reviewer: 'Buys the second report' };
const stageDefinitions = [
  { title: 'Poppy', subtitle: 'Identity + approval', steps: ['session', 'approval'] },
  { title: 'x402', subtitle: 'Exact price', steps: ['price'] },
  { title: 'Policy', subtitle: 'Budget + rules', steps: ['policy'] },
  { title: 'NEAR', subtitle: 'Saved payment', steps: ['payment'] },
  { title: 'Result', subtitle: 'Report + retry', steps: ['delivery', 'retry'] }
];
function integer(value) { try { const s = String(value ?? '0'); return /^\d+$/.test(s) ? BigInt(s) : 0n; } catch { return 0n; } }
function micro(value) { const raw = String(value ?? '0'), negative = /^-\d+$/.test(raw), n = integer(negative ? raw.slice(1) : raw), whole = n / MICRO, rest = (n % MICRO).toString().padStart(18, '0').replace(/0+$/, ''); return (negative && n > 0n ? '−' : '') + whole.toString() + (rest ? '.' + rest : ''); }
function title(value) { return names[value] ?? String(value ?? 'Agent').replace(/[-_]/g, ' '); }
function text(id, value) { $(id).textContent = String(value ?? ''); }
function node(tag, className, value) { const n = document.createElement(tag); if (className) n.className = className; if (value !== undefined) n.textContent = String(value); return n; }
function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function time(value) { return date(value)?.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) ?? ''; }
function stateLabel(order) { if (order.paymentState === 'settled' && order.deliveryState === 'delivered') return 'Delivered'; if (order.paymentState === 'settled') return 'Paid'; if (['issued','pending'].includes(order.paymentState)) return 'Payment pending'; if (order.paymentState === 'reserved') return 'Reserved'; if (order.paymentState === 'deferred') return 'Deferred'; if (order.paymentState === 'failed') return 'Failed'; if (order.paymentState === 'cancelled') return 'Cancelled'; return 'Not paid'; }
function badgeClass(order) { return order.paymentState === 'settled' ? 'state-badge' : ['issued','pending','reserved'].includes(order.paymentState) ? 'state-badge pending' : 'state-badge neutral'; }
function safeTxLink(tx) { return 'https://testnet.nearblocks.io/txns/' + encodeURIComponent(String(tx)); }
function selectedOrder() { return currentState?.orders?.find(o => o.id === selectedId); }
function setConnection(ok) { connected = ok; $('connection').className = 'connection ' + (ok ? 'connected' : 'disconnected'); $('connection').replaceChildren(node('i'), document.createTextNode(ok ? 'Local controller connected' : 'Local controller disconnected')); }
function showError() { const message = actionError || (!connected ? 'The local controller is not reachable. This page keeps the last recorded state and will reconnect automatically.' : currentState?.error || ''); $('error-banner').hidden = !message; text('error-banner', message); }
function updateButton() { const running = currentState?.run?.status === 'running'; $('run-button').disabled = !connected || !currentState?.ready || running || submitting; text('run-label', submitting ? 'Starting…' : running ? 'Running existing purchases…' : 'Run again — no new payments'); }
function renderMetrics(state) {
  const budget = integer(state.policy?.jobBudgetAtomic), committed = integer(state.budget?.committedAtomic), settled = integer(state.budget?.settledAtomic), held = integer(state.budget?.heldAtomic);
  const percent = (n) => budget > 0n ? Math.min(100, Number(n * 10000n / budget) / 100) : 0;
  text('budget-fraction', state.policy ? micro(committed) + ' / ' + micro(budget) + ' micro-wNEAR' : '—');
  $('settled-bar').style.width = percent(settled) + '%'; $('held-bar').style.width = Math.min(100 - percent(settled), percent(held)) + '%';
  document.querySelector('.budget-track').setAttribute('aria-valuenow', String(percent(committed)));
  text('paid-label', micro(settled) + ' paid'); text('held-label', micro(held) + ' held'); text('remaining-label', micro(budget > committed ? budget - committed : 0n) + ' left');
  const orders = Array.isArray(state.orders) ? state.orders : [];
  text('purchase-count', orders.length); text('purchase-caption', orders.filter(o => o.deliveryState === 'delivered').length + ' reports delivered');
  text('new-payments', state.run?.summary ? state.run.summary.newIssuances : '—');
  text('new-caption', state.run?.summary ? 'Confirmed by this run' : state.run?.status === 'running' ? 'Replay mode · no new payments permitted' : 'No replay completed yet');
}
function renderBanner(state) {
  const run = state.run ?? {}, status = run.status ?? 'idle';
  $('run-banner').className = 'run-banner ' + status;
  const cases = {
    idle: ['✓', 'These purchases have already happened', 'The cards below show the recorded payments. Run them again to see the requests and recovery step by step.'],
    running: ['↻', 'Replaying the real protocol requests', 'The workflow is contacting the local supplier and retrieving the existing reports. It cannot create a new payment.'],
    succeeded: ['✓', 'Replay complete. Your reports are back.', run.summary ? run.summary.newIssuances + ' new payments · ' + micro(run.summary.balanceDeltaAtomic) + ' micro-wNEAR recipient balance change.' : 'Both existing purchases were retrieved.'],
    failed: ['!', 'The workflow stopped', run.error || 'Inspect the last activity below. Do not assume a stopped request means a payment failed.']
  };
  const message = !state.ready && status === 'idle' ? ['○', 'The existing purchases are not ready to replay', state.error || 'This dashboard needs the prepared testnet ledger. It will not create accounts or make purchases automatically.'] : cases[status] ?? cases.idle;
  text('run-icon', message[0]); text('run-title', message[1]); text('run-description', message[2]);
  text('run-duration', run.startedAt ? 'Started ' + time(run.startedAt) : 'Recorded state');
  text('agent-mode', status === 'running' ? 'Live requests · existing purchases' : 'Recorded ledger state');
}
function renderAgents(state) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  if (!orders.some(o => o.id === selectedId)) selectedId = orders.find(o => o.principalId === 'researcher')?.id ?? orders[0]?.id ?? null;
  const container = $('agent-cards'); container.replaceChildren();
  if (!orders.length) { container.append(node('div','empty-card','No purchases are recorded in this local ledger yet. The dashboard does not initiate a new purchase.')); return; }
  for (const order of orders) {
    const card = node('button','agent-card' + (order.id === selectedId ? ' selected' : '')); card.type = 'button'; card.setAttribute('aria-pressed', String(order.id === selectedId)); card.setAttribute('aria-label', title(order.principalId) + ' purchase, ' + stateLabel(order));
    const top = node('span','agent-card-top'), identity = node('span');
    top.append(node('span','agent-avatar ' + (order.principalId === 'reviewer' ? 'reviewer' : ''), title(order.principalId).slice(0,1)));
    identity.append(node('span','agent-name',title(order.principalId)),node('span','agent-role',roles[order.principalId] ?? 'Buying agent')); top.append(identity,node('span','agent-select-mark',order.id === selectedId ? '●' : '○'));
    const bottom = node('span','agent-card-bottom'), amount = node('span'), value = node('span','agent-amount',micro(order.amountAtomic) + ' ');
    value.append(node('small','', 'micro-wNEAR')); amount.append(value,node('span','agent-caption','Recorded purchase')); bottom.append(amount,node('span',badgeClass(order),stateLabel(order))); card.append(top,bottom);
    card.addEventListener('click',()=>{selectedId = order.id; renderAgents(currentState); renderFlow(currentState); renderDetails();}); container.append(card);
  }
}
function renderFlow(state) {
  const order = selectedOrder(), events = (state.run?.events ?? []).filter(e => e.principal === order?.principalId), hasRun = Boolean(state.run?.id), running = state.run?.status === 'running';
  text('flow-heading', order ? title(order.principalId) + ' · purchase path' : 'The purchase path');
  text('flow-subtitle', hasRun ? 'Observed steps from the latest replay, not a new purchase.' : 'Recorded outcome. Run again to observe each protocol step.');
  text('flow-tag', running ? 'Live replay' : hasRun ? 'Last replay' : 'Recorded');
  const pipeline = $('pipeline'); pipeline.replaceChildren();
  let lastMessage = hasRun ? 'This agent has not reported a step in the current run yet.' : 'A recorded payment is not a new payment. Replay shows the requests using the saved authorization.';
  for (const [i, definition] of stageDefinitions.entries()) {
    const found = events.filter(e => definition.steps.includes(e.step)), latest = found.at(-1);
    let status = '';
    if (hasRun) { if (latest?.status === 'started') status = 'active'; else if (latest?.status === 'blocked') status = 'blocked'; else if (latest) status = 'done'; }
    else if (order?.paymentState === 'settled') status = i < 4 || order.deliveryState === 'delivered' ? 'done' : '';
    const stage = node('div','stage ' + status); stage.append(node('span','stage-circle',status === 'done' ? '✓' : status === 'blocked' ? '!' : String(i+1)),node('span','stage-title',definition.title),node('span','stage-subtitle',definition.subtitle)); pipeline.append(stage);
  }
  if (events.length) lastMessage = events.at(-1).message;
  text('stage-explanation', lastMessage);
}
function renderDetails() {
  const order = selectedOrder(); $('detail-empty').hidden = !!order; $('detail-content').hidden = !order;
  if (!order) { text('detail-title','Purchase details'); text('detail-state','—'); return; }
  text('detail-title', title(order.principalId) + ' report'); text('detail-state', stateLabel(order)); $('detail-state').className = badgeClass(order);
  text('detail-agent', title(order.principalId)); text('detail-price', micro(order.amountAtomic) + ' micro-wNEAR');
  text('detail-payment', order.paymentState === 'settled' ? 'Settled on testnet' : stateLabel(order)); text('detail-delivery', order.deliveryState === 'delivered' ? 'Report received' : 'Not delivered yet');
  let result = null; try { result = JSON.parse(order.result?.text ?? 'null'); } catch {}
  const receipts = Array.isArray(result?.transferReceipt) ? result.transferReceipt : [];
  text('result-summary', order.result ? 'A finalized testnet transfer report, with the transaction and receipt evidence returned by the supplier.' : 'A report is released only after payment is confirmed. There is no stored result for this order yet.');
  const facts = $('result-facts'); facts.replaceChildren();
  if (order.result) {
    facts.append(node('div','result-fact','✓ Result saved for repeat retrieval'));
    if (receipts.length) facts.append(node('div','result-fact', '✓ ' + receipts.length + ' transfer receipt' + (receipts.length === 1 ? '' : 's') + ' in the report'));
    if (result?.checkedAt && date(result.checkedAt)) facts.append(node('div','result-fact','Recorded ' + date(result.checkedAt).toLocaleString()));
  }
  const tx = order.transactionId || result?.transactionId;
  $('transaction-link').hidden = !tx; if (tx) $('transaction-link').href = safeTxLink(tx); else $('transaction-link').removeAttribute('href');
  text('transaction-id', tx ?? ''); text('result-json', result ? JSON.stringify(result,null,2) : order.result?.text ?? 'No result is stored yet.');
}
function renderActivity(state) {
  const run = state.run ?? {}, events = Array.isArray(run.events) ? run.events : [];
  const signature = JSON.stringify([run.id,events]); if (signature === lastEvents) return; lastEvents = signature;
  const list = $('activity-list'), shouldScroll = list.scrollTop + list.clientHeight >= list.scrollHeight - 50;
  $('activity-empty').hidden = events.length > 0; text('event-count', events.length + ' event' + (events.length === 1 ? '' : 's'));
  list.replaceChildren();
  for (const event of events) {
    const item = node('li','activity-item' + (event.status === 'blocked' ? ' blocked' : '')), content = node('div');
    item.append(node('span','activity-icon',event.status === 'blocked' ? '!' : event.status === 'started' ? '↻' : event.status === 'reused' ? '↺' : '✓'));
    content.append(node('div','activity-agent',event.principal ? title(event.principal) : 'Workflow'),node('div','activity-message',event.message || 'Workflow event'));
    item.append(content,node('time','activity-time',time(event.at))); list.append(item);
  }
  if (shouldScroll) list.scrollTop = list.scrollHeight;
  const blocked = events.findLast(e => e.status === 'blocked' && e.step === 'budget');
  text('policy-note', blocked?.message || 'The policy caps the total spend. The model cannot increase it or change the payment recipient.');
}
function render(state) {
  currentState = state;
  if (state.run?.id !== lastRunId) {lastRunId = state.run?.id;lastEvents = '';}
  renderMetrics(state); renderBanner(state); renderAgents(state); renderFlow(state); renderDetails(); renderActivity(state); updateButton(); showError(); text('last-updated','Updated ' + time(new Date().toISOString()));
}
async function refresh() {
  const serial = ++refreshSerial;
  clearTimeout(timer);
  try {
    const response = await fetch('/api/state',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('State unavailable');
    const state = await response.json(); if (!state || !Array.isArray(state.orders) || typeof state.ready !== 'boolean') throw new Error('Invalid state');
    if (serial !== refreshSerial) return;
    setConnection(true); render(state);
  } catch {if (serial !== refreshSerial) return;setConnection(false); showError(); updateButton();}
  if (serial === refreshSerial) timer = setTimeout(refresh, currentState?.run?.status === 'running' && connected ? 500 : 2000);
}
$('run-button').addEventListener('click', async()=>{
  if (!connected || !currentState?.ready || submitting || currentState.run?.status === 'running') return;
  submitting = true; actionError = ''; updateButton(); showError();
  try {
    const response = await fetch('/api/run',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','X-Dashboard-Token':TOKEN ?? ''},body:'{}',signal:AbortSignal.timeout(10000)});
    if (!response.ok) {const body = await response.json().catch(()=>null);throw new Error(body?.error || 'Could not start the replay.');}
    await refresh();
  } catch(error) {actionError = error instanceof Error ? error.message : 'Could not start the replay.';}
  finally {submitting = false; updateButton(); showError();}
});
refresh();
