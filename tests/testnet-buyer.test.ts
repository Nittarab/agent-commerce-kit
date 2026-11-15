import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../packages/ledger/index.ts';
import { FixtureSigner } from '../packages/wallet/index.ts';
import { FixtureRail } from '../packages/wallet/fixture-rail.ts';
import { sha256 } from '../packages/core/index.ts';
import { operationFor, assertApproval } from '../packages/poppy/live.ts';
import { CommerceError } from '../packages/commerce/index.ts';
import { purchaseTestnetService } from '../apps/testnet/buyer.ts';
import type { TestnetBuyerOptions } from '../apps/testnet/buyer.ts';
import { offer as makeOffer, policy } from './fixtures.ts';

/** SIMULATION: real ledger and SDK codecs, no network, key material, or NEAR signing. */
function fixture() {
 const offer = makeOffer({ method: 'GET', bodyHash: sha256('') });
 const ledger = new Ledger(':memory:', policy()), rail = new FixtureRail(':memory:');
 let now = Date.parse('2027-01-01T00:00:00Z') / 1000, approval: string | undefined;
 let preparations = 0, signatures = 0, saves = 0, requests = 0;
 const paidHeaders: Record<string, string>[] = [];
 const steps: string[] = [];
 const options: TestnetBuyerOptions = {
  principalId: 'researcher', offer, replayOnly: false, maxTimeoutSeconds: 120, now: () => now,
  ledger: {
   lookup: (...args) => ledger.lookup(...args),
   authorize: (principal, value) => ledger.authorize(principal, value, new Date(now * 1000)),
   issue: (principal, id, build) => ledger.issue(principal, id, build, new Date(now * 1000)),
   deliver: (...args) => ledger.deliver(...args),
  },
  loadApproval: () => approval,
  saveApproval: header => { assert.equal(approval, undefined); approval = header; saves++; },
  sessionHeaders: async () => ({ 'Poppy-Session': 'SIMULATED-SESSION' }),
  preparePayment: async () => { preparations++; return order => { signatures++; return new FixtureSigner().sign(order); }; },
  inspectSettlement: async order => rail.inspect(order)!,
  progress: step => steps.push(step),
  transport: async ({ headers, url }) => {
   requests++; assert.equal(url, offer.url);
   if (!headers['Poppy-Approval']) return { status: 403, headers: {}, text: JSON.stringify({ error: 'approval_required', operation: operationFor(offer) }) };
   assert.equal(headers['Poppy-Approval'], approval);
   const current = ledger.lookup('researcher', offer);
   assertApproval(headers['Poppy-Approval'], offer, now, current?.deliveryState === 'delivered');
   if (!headers['PAYMENT-SIGNATURE']) return { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: offer.url }, accepts: [{ scheme: 'exact', network: offer.network, amount: offer.amountAtomic, asset: offer.asset, payTo: offer.payTo, maxTimeoutSeconds: 120 }] })).toString('base64') }, text: '{}' };
   paidHeaders.push({ ...headers });
   const payload = Buffer.from(headers['PAYMENT-SIGNATURE'], 'base64').toString();
   const transaction = rail.prepare(current!, payload, 'success');
   const order = current!.paymentState === 'issued' ? ledger.submission(current!.id, transaction) : current!;
   ledger.reconcile(rail.inspect(order)!);
   return { status: 200, headers: { 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction, network: offer.network, payer: offer.payer })).toString('base64') }, text: JSON.stringify({ simulation: true, report: 'exact fixture result' }) };
  },
 };
 return { options, ledger, rail, paidHeaders, steps, get preparations() { return preparations; }, get signatures() { return signatures; }, get saves() { return saves; }, get requests() { return requests; }, setNow: (value: number) => { now = value; }, clearApproval: () => { approval = undefined; }, close: () => { rail.close(); ledger.close(); } };
}

test('testnet buyer uses SDK for fresh purchase and expired exact replay without preparing or signing again', async () => {
 const f = fixture(); try {
  const first = await purchaseTestnetService(f.options);
  assert.deepEqual(first.result, { simulation: true, report: 'exact fixture result' });
  assert.equal(f.preparations, 1); assert.equal(f.signatures, 1); assert.equal(f.saves, 1);
  assert.ok(f.steps.includes('approval')); assert.ok(f.steps.includes('retry'));
  f.setNow(Date.parse('2030-01-01T00:00:00Z') / 1000);
  f.options.replayOnly = true;
  const again = await purchaseTestnetService(f.options);
  assert.equal(again.transactionId, first.transactionId);
  assert.equal(again.orderId, first.orderId);
  assert.equal(f.preparations, 1); assert.equal(f.signatures, 1); assert.equal(f.saves, 1);
  assert.equal(f.ledger.audit().filter(event => JSON.parse(event.event).type === 'issued').length, 1);
  assert.equal(new Set(f.paidHeaders.map(headers => headers['Poppy-Approval'])).size, 1);
  assert.equal(new Set(f.paidHeaders.map(headers => headers['PAYMENT-SIGNATURE'])).size, 1);
 } finally { f.close(); }
});

test('replay-only rejects absent, reserved, issued or approval-less purchases before transport or preparation', async () => {
 for (const state of ['absent', 'reserved', 'issued', 'missing-approval']) {
  const f = fixture(); try {
   if (state === 'missing-approval') { await purchaseTestnetService(f.options); f.clearApproval(); }
   else if (state !== 'absent') {
    const order = f.options.ledger.authorize('researcher', f.options.offer).order!;
    if (state === 'issued') f.ledger.issue('researcher', order.id, value => new FixtureSigner().sign(value));
   }
   const requests = f.requests, preparations = f.preparations, audit = f.ledger.audit().length;
   f.options.replayOnly = true;
   await assert.rejects(purchaseTestnetService(f.options), /Replay-only requires/);
   assert.equal(f.requests, requests); assert.equal(f.preparations, preparations); assert.equal(f.ledger.audit().length, audit);
  } finally { f.close(); }
 }
});

test('lost first paid response recovers the same issued attempt through the SDK without another signer', async () => {
 const f = fixture(); try {
  const transport = f.options.transport;
  let lost = false;
  f.options.transport = async request => {
   if (request.headers['PAYMENT-SIGNATURE'] && !lost) { lost = true; throw new Error('SIMULATED transport loss before supplier acceptance'); }
   return transport(request);
  };
  await assert.rejects(purchaseTestnetService(f.options), error => error instanceof CommerceError && error.stage === 'payment');
  const issued = f.ledger.lookup('researcher', f.options.offer)!;
  assert.equal(issued.paymentState, 'issued'); assert.equal(f.ledger.budget('researcher').jobCommittedAtomic, '60');
  const result = await purchaseTestnetService(f.options);
  assert.equal(result.orderId, issued.id); assert.equal(f.preparations, 1); assert.equal(f.signatures, 1); assert.equal(f.saves, 1);
 } finally { f.close(); }
});

test('merchant success cannot bypass missing or contradictory independently stored evidence', async () => {
 for (const mutation of ['missing', 'unknown', 'transaction']) {
  const f = fixture(); try {
   const inspect = f.options.inspectSettlement;
   f.options.inspectSettlement = async (...args) => {
    if (mutation === 'missing') throw new Error('No persisted final evidence');
    const evidence = await inspect(...args);
    return mutation === 'unknown' ? { ...evidence, final: false, outcome: 'unknown' } : { ...evidence, transactionId: 'wrong-transaction' };
   };
   await assert.rejects(purchaseTestnetService(f.options), error => error instanceof CommerceError && error.stage === 'settlement');
   assert.equal(f.ledger.lookup('researcher', f.options.offer)!.deliveryState, 'not_delivered');
   assert.equal(f.ledger.budget('researcher').jobCommittedAtomic, '60');
   assert.equal(f.signatures, 1);
  } finally { f.close(); }
 }
});

test('cancellation during payment preparation retains reservation and cannot issue after the caller stops waiting', async () => {
 const f = fixture(); try {
  const controller = new AbortController();
  f.options.signal = controller.signal;
  let release: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let prepared: () => void = () => {};
  const entered = new Promise<void>(resolve => { prepared = resolve; });
  let signatures = 0;
  f.options.preparePayment = async () => { prepared(); await waiting; return order => { signatures++; return new FixtureSigner().sign(order); }; };
  const purchase = purchaseTestnetService(f.options);
  await entered; controller.abort();
  await assert.rejects(purchase, error => error instanceof CommerceError && error.stage === 'issuance');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(signatures, 0);
  assert.equal(f.ledger.lookup('researcher', f.options.offer)!.paymentState, 'reserved');
  assert.equal(f.ledger.budget('researcher').jobCommittedAtomic, '60');
 } finally { f.close(); }
});
