import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTeam } from '../packages/agent/team.ts';
import type { Turn } from '../packages/agent/index.ts';
const services = [{ id: 'research', description: 'Pinned research service', principals: ['researcher'] }];
const receipt = { orderId: 'order-1', transactionId: 'SIMULATED', digest: 'a'.repeat(64), summary: 'Verified host-selected fact' };
const script = (...turns: Turn[]) => ({ next: async () => turns.shift()! });
const buy: Turn = { type: 'tool', name: 'purchase_service', input: { serviceId: 'research' } };
const done: Turn = { type: 'done', output: 'Complete' };
test('team coalesces purchases and hands bounded results to the next peer', async () => {
 let calls = 0;
 const results = await runAgentTeam({ services, maxPurchases: 1, maxSteps: 4, timeoutMs: 1000,
  purchase: async (principal, service) => { assert.equal(principal, 'researcher'); assert.equal(service, 'research'); calls++; return receipt; },
  members: [{ principalId: 'researcher', model: () => script(buy, buy, done) }, { principalId: 'reviewer', model: previous => { assert.deepEqual(previous, [{ principalId: 'researcher', output: 'Complete' }]); return script(done); } }],
 });
 assert.equal(calls, 1); assert.equal(results.length, 2);
});
test('team rejects forged principals and ungranted services before host purchase', async () => {
 let calls = 0;
 for (const [principalId, input] of [['reviewer', { serviceId: 'research' }], ['researcher', { serviceId: 'research', principalId: 'reviewer' }]] as const) {
  await assert.rejects(runAgentTeam({ services, maxPurchases: 2, maxSteps: 2, timeoutMs: 1000, purchase: async () => { calls++; return receipt; }, members: [{ principalId, model: () => script({ type: 'tool', name: 'purchase_service', input }, done) }] }));
 }
 assert.equal(calls, 0);
});
test('zero purchase allowance denies before host payment and timeout aborts team without retry', async () => {
 let calls = 0;
 const base = { services, maxSteps: 3, timeoutMs: 20, members: [{ principalId: 'researcher', model: () => script(buy, done) }] };
 await assert.rejects(runAgentTeam({ ...base, maxPurchases: 0, purchase: async () => { calls++; return receipt; } }), /purchase limit/);
 await assert.rejects(runAgentTeam({ ...base, maxPurchases: 1, purchase: async (_principal, _service, signal) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Uncertain, retained')), { once: true })); } }), /deadline/);
 assert.equal(calls, 1);
});
