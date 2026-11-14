import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../packages/core/index.ts';
import type { Offer, Usage } from '../packages/core/index.ts';
import { evaluatePolicy, renderPolicy, validatePolicy } from '../packages/policy/index.ts';

const policyUrl = new URL('../policies/demo.json', import.meta.url);
const policy = validatePolicy(JSON.parse(readFileSync(policyUrl, 'utf8')));
const now = new Date('2026-11-14T12:00:00Z');
const emptyUsage: Usage = { jobCommittedAtomic: '0', principalCommittedAtomic: '0' };
const offer: Offer = {
  operationId: 'operation-1',
  revision: '1',
  jobId: 'demo-job',
  supplierId: 'fixture-supplier',
  origin: 'https://supplier.example',
  method: 'POST',
  url: 'https://supplier.example/research?format=json',
  bodyHash: sha256('{}'),
  network: 'near:testnet',
  asset: 'demo-token.testnet',
  payer: 'buyer.testnet',
  payTo: 'supplier.testnet',
  amountAtomic: '70',
  expiresAt: '2026-11-14T12:05:00Z',
};

test('both principals can use their grants at an inclusive budget boundary', () => {
  const first = evaluatePolicy(policy, 'researcher', offer, emptyUsage, now);
  assert.equal(first.allowed, true);
  assert.equal(first.policyVersion, policy.version);

  const spent = { jobCommittedAtomic: '70', principalCommittedAtomic: '0' };
  assert.equal(evaluatePolicy(policy, 'reviewer', { ...offer, amountAtomic: '30' }, spent, now).allowed, true);
  assert.equal(evaluatePolicy(policy, 'reviewer', { ...offer, amountAtomic: '40' }, emptyUsage, now).allowed, true);
});

test('each budget limit is enforced independently', () => {
  const cases: [string, string, Usage][] = [
    ['purchase_limit_exceeded', '41', emptyUsage],
    ['principal_budget_exceeded', '40', { jobCommittedAtomic: '1', principalCommittedAtomic: '1' }],
    ['job_budget_exceeded', '31', { jobCommittedAtomic: '70', principalCommittedAtomic: '0' }],
  ];
  for (const [code, amountAtomic, usage] of cases) {
    const decision = evaluatePolicy(policy, 'reviewer', { ...offer, amountAtomic }, usage, now);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, code);
  }
});

test('offers cannot replace configured identity and payment terms', () => {
  assert.equal(evaluatePolicy(policy, 'intruder', offer, emptyUsage, now).code, 'unknown_principal');
  const changes: [Partial<Offer>, string][] = [
    [{ jobId: 'other-job' }, 'wrong_job'],
    [{ supplierId: 'other-supplier' }, 'supplier_denied'],
    [{ origin: 'https://supplier.example.evil.example' }, 'wrong_origin'],
    [{ url: 'https://supplier.example.evil.example/research' }, 'wrong_origin'],
    [{ url: 'https://supplier.example:8443/research' }, 'wrong_origin'],
    [{ payTo: 'other.testnet' }, 'wrong_recipient'],
    [{ payer: 'other.testnet' }, 'wrong_payer'],
    [{ network: 'near:mainnet' }, 'wrong_network'],
    [{ asset: 'other-token.testnet' }, 'wrong_asset'],
  ];
  for (const [change, code] of changes) {
    const decision = evaluatePolicy(policy, 'researcher', { ...offer, ...change }, emptyUsage, now);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, code);
  }

  const other = { id: 'other-supplier', origin: offer.origin, payTo: offer.payTo };
  const expanded = { ...policy, suppliers: [...policy.suppliers, other] };
  assert.equal(evaluatePolicy(expanded, 'researcher', { ...offer, supplierId: other.id }, emptyUsage, now).code,
    'supplier_denied');
});

test('malformed offers and noncanonical u128 amounts deny by default', () => {
  const invalid: unknown[] = [
    null, [], Object.create(offer), { ...offer, principalId: 'researcher' },
    { ...offer, operationId: '' }, { ...offer, revision: '' },
    { ...offer, method: 'post' }, { ...offer, bodyHash: 'short' },
    { ...offer, url: 'https://supplier.example@evil.example/research' },
    { ...offer, url: 'https://@supplier.example/research' },
    { ...offer, url: 'http://supplier.example/research' },
    { ...offer, url: 'https://supplier.example/research#fragment' },
    { ...offer, url: 'https://supplier.example\\@evil.example/research' },
    { ...offer, origin: 'https://supplier.example/' },
    { ...offer, expiresAt: '2026-11-31T12:00:00Z' },
    ...[70, '0', '070', '70\n', '+70', '-1', '1e1', '1.0', (1n << 128n).toString()]
      .map(amountAtomic => ({ ...offer, amountAtomic })),
  ];
  for (const item of invalid) {
    const decision = evaluatePolicy(policy, 'researcher', item as Offer, emptyUsage, now);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, 'invalid_offer');
  }
});

test('u128 arithmetic stays exact above the safe integer limit', () => {
  const max = ((1n << 128n) - 1n).toString();
  const largePolicy = {
    ...policy,
    jobBudgetAtomic: max,
    grants: policy.grants.map(grant => ({ ...grant, maxPerPurchaseAtomic: max, maxTotalAtomic: max })),
  };
  assert.equal(evaluatePolicy(largePolicy, 'researcher', { ...offer, amountAtomic: max }, emptyUsage, now).allowed,
    true);
  const usage = { jobCommittedAtomic: '1', principalCommittedAtomic: '0' };
  assert.equal(evaluatePolicy(largePolicy, 'researcher', { ...offer, amountAtomic: max }, usage, now).code,
    'job_budget_exceeded');
});

test('expiry boundaries and invalid time or usage deny by default', () => {
  assert.equal(evaluatePolicy(policy, 'researcher', { ...offer, expiresAt: now.toISOString() }, emptyUsage, now).code,
    'offer_expired');
  const grants = policy.grants.map(grant => ({ ...grant, expiresAt: now.toISOString() }));
  assert.equal(evaluatePolicy({ ...policy, grants }, 'researcher', offer, emptyUsage, now).code, 'grant_expired');
  const expired = { ...policy, expiresAt: now.toISOString() };
  assert.equal(evaluatePolicy(expired, 'researcher', offer, emptyUsage, now).code, 'policy_expired');
  assert.equal(evaluatePolicy(policy, 'researcher', offer, emptyUsage, new Date(NaN)).code, 'invalid_time');
  for (const usage of [
    { jobCommittedAtomic: '00', principalCommittedAtomic: '0' },
    { jobCommittedAtomic: '0', principalCommittedAtomic: '1' },
  ]) {
    assert.equal(evaluatePolicy(policy, 'researcher', offer, usage, now).code, 'invalid_usage');
  }
});

test('strict validation reports invalid configuration fields', () => {
  const [supplier] = policy.suppliers;
  const [grant] = policy.grants;
  const changes: [object, RegExp][] = [
    [{ network: 'near:mainnet' }, /policy.network/],
    [{ asset: 'demo token' }, /policy.asset/],
    [{ expiresAt: '2030-02-29T00:00:00Z' }, /policy.expiresAt/],
    [{ jobBudgetAtomic: 100 }, /policy.jobBudgetAtomic/],
    [{ defaultAllow: true }, /unexpected field defaultAllow/],
    [{ suppliers: [supplier, { ...supplier, origin: 'https://other.example' }] }, /supplier IDs must be unique/],
    [{ suppliers: [{ ...supplier, origin: 'https://supplier.example/research' }] }, /exact HTTPS origin/],
    [{ suppliers: [{ ...supplier, origin: 'https://supplier.example:443' }] }, /canonical HTTPS authority/],
    [{ suppliers: [{ ...supplier, origin: 'https://supplier.example?' }] }, /exact HTTPS origin/],
    [{ grants: [grant, grant] }, /grant principal IDs must be unique/],
    [{ grants: [{ ...grant, suppliers: ['missing'] }] }, /unknown supplier/],
    [{ grants: [{ ...grant, suppliers: [supplier.id, supplier.id] }] }, /suppliers must be unique/],
  ];
  for (const [change, expected] of changes) {
    assert.throws(() => validatePolicy({ ...policy, ...change }), expected);
  }
});

test('CLI renders a valid policy and returns an error for invalid policy data', context => {
  const cli = fileURLToPath(new URL('../packages/policy/cli.ts', import.meta.url));
  const valid = spawnSync(process.execPath, [cli, fileURLToPath(policyUrl)], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), renderPolicy(policy));
  assert.match(valid.stdout, /Deny all purchases/);
  assert.match(valid.stdout, /shared job budget is 100 atomic units/);
  const directory = mkdtempSync(join(tmpdir(), 'kit-policy-'));
  context.after(() => rmSync(directory, { recursive: true }));
  const invalidPath = join(directory, 'invalid.json');
  writeFileSync(invalidPath, JSON.stringify({ ...policy, jobBudgetAtomic: 100 }));
  const bad = spawnSync(process.execPath, [cli, invalidPath], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /policy.jobBudgetAtomic/);
});
