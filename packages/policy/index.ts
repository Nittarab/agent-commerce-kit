import { types } from 'node:util';
import { atomic, timestamp } from '../core/index.ts';
import type { Decision, Grant, Offer, Policy, Supplier, Usage } from '../core/index.ts';

function object(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof input !== 'object' || !input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error(`${path} must be a plain object`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${path}.${key} must be an own data property`);
    }
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !keys.includes(key)) {
      throw new Error(`${path} contains an unexpected field ${String(key)}`);
    }
  }
  return input as Record<string, unknown>;
}

function token(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error(`${path} must be a non-empty token`);
  }
  return value;
}

function checkedString(value: unknown, path: string, check: (value: unknown) => unknown): string {
  try {
    check(value);
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return value as string;
}

function httpsUrl(value: unknown, path: string): URL {
  if (typeof value !== 'string' || !value.startsWith('https://')
      || /[\x00-\x20\x7f\\#]/.test(value)) {
    throw new Error(`${path} must be an absolute HTTPS URL without a fragment`);
  }
  const url = URL.parse(value);
  // Require the serialized authority literally, including a non-default port when present.
  const authority = value.split(/[/?]/)[2];
  if (!url || !authority || `https://${authority}` !== url.origin) {
    throw new Error(`${path} must use a canonical HTTPS authority without credentials`);
  }
  return url;
}

function origin(value: unknown, path: string): string {
  const url = httpsUrl(value, path);
  if (value !== url.origin) throw new Error(`${path} must be an exact HTTPS origin`);
  return url.origin;
}

function list<T>(value: unknown, path: string, read: (item: unknown, path: string) => T): T[] {
  if (types.isProxy(value) || !Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${path} must be a dense array without extra properties`);
  }
  return Array.from({ length: value.length }, (_, index) => {
    const itemPath = `${path}[${index}]`;
    const item = Object.getOwnPropertyDescriptor(value, index);
    if (!item || !Object.hasOwn(item, 'value')) throw new Error(`${itemPath} must be an own data property`);
    return read(item.value, itemPath);
  });
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} must be unique`);
}

export function validatePolicy(input: unknown): Policy {
  const value = object(input, ['id', 'version', 'jobId', 'network', 'asset', 'payer', 'jobBudgetAtomic',
    'expiresAt', 'suppliers', 'grants'], 'policy');
  if (value.network !== 'near:testnet') throw new Error('policy.network must be near:testnet');
  const suppliers = list(value.suppliers, 'policy.suppliers', (item, path): Supplier => {
    const supplier = object(item, ['id', 'origin', 'payTo'], path);
    return {
      id: token(supplier.id, `${path}.id`),
      origin: origin(supplier.origin, `${path}.origin`),
      payTo: token(supplier.payTo, `${path}.payTo`),
    };
  });
  const supplierIds = suppliers.map(supplier => supplier.id);
  unique(supplierIds, 'policy supplier IDs');
  const grants = list(value.grants, 'policy.grants', (item, path): Grant => {
    const grant = object(item, ['principalId', 'suppliers', 'maxPerPurchaseAtomic',
      'maxTotalAtomic', 'expiresAt'], path);
    const allowedSuppliers = list(grant.suppliers, `${path}.suppliers`, token);
    unique(allowedSuppliers, `${path}.suppliers`);
    for (const supplier of allowedSuppliers) {
      if (!supplierIds.includes(supplier)) throw new Error(`${path}.suppliers contains unknown supplier ${supplier}`);
    }
    return {
      principalId: token(grant.principalId, `${path}.principalId`),
      suppliers: allowedSuppliers,
      maxPerPurchaseAtomic: checkedString(grant.maxPerPurchaseAtomic, `${path}.maxPerPurchaseAtomic`, atomic),
      maxTotalAtomic: checkedString(grant.maxTotalAtomic, `${path}.maxTotalAtomic`, atomic),
      expiresAt: checkedString(grant.expiresAt, `${path}.expiresAt`, timestamp),
    };
  });
  unique(grants.map(grant => grant.principalId), 'policy grant principal IDs');
  return {
    id: token(value.id, 'policy.id'),
    version: token(value.version, 'policy.version'),
    jobId: token(value.jobId, 'policy.jobId'),
    network: value.network,
    asset: token(value.asset, 'policy.asset'),
    payer: token(value.payer, 'policy.payer'),
    jobBudgetAtomic: checkedString(value.jobBudgetAtomic, 'policy.jobBudgetAtomic', atomic),
    expiresAt: checkedString(value.expiresAt, 'policy.expiresAt', timestamp),
    suppliers,
    grants,
  };
}

export function evaluatePolicy(policy: Policy, principalId: string, offer: Offer, usage: Usage,
  now: Date = new Date()): Decision {
  let policyVersion = '';
  const deny = (code: string, explanation: string): Decision => ({ allowed: false, code, explanation, policyVersion });
  try {
    policy = validatePolicy(policy);
    policyVersion = policy.version;
  } catch {
    return deny('invalid_policy', 'The policy is invalid.');
  }

  let amount: bigint;
  let expiresAt: number;
  let url: URL;
  try {
    const fields = object(offer, ['operationId', 'revision', 'jobId', 'supplierId', 'origin',
      'method', 'url', 'bodyHash', 'network', 'asset', 'payer', 'payTo', 'amountAtomic', 'expiresAt'], 'offer');
    for (const field of ['operationId', 'revision', 'jobId', 'supplierId', 'network', 'asset', 'payer', 'payTo']) {
      token(fields[field], `offer.${field}`);
    }
    if (typeof fields.method !== 'string' || !/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/.test(fields.method)
        || typeof fields.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(fields.bodyHash)) {
      return deny('invalid_offer', 'The offer method or body hash is invalid.');
    }
    origin(fields.origin, 'offer.origin');
    url = httpsUrl(fields.url, 'offer.url');
    amount = atomic(fields.amountAtomic);
    expiresAt = timestamp(fields.expiresAt);
  } catch {
    return deny('invalid_offer', 'The offer contains invalid terms.');
  }

  let jobCommitted: bigint;
  let principalCommitted: bigint;
  try {
    const fields = object(usage, ['jobCommittedAtomic', 'principalCommittedAtomic'], 'usage');
    jobCommitted = atomic(fields.jobCommittedAtomic, true);
    principalCommitted = atomic(fields.principalCommittedAtomic, true);
  } catch {
    return deny('invalid_usage', 'The recorded usage is invalid.');
  }
  if (principalCommitted > jobCommitted) return deny('invalid_usage', 'Principal usage exceeds job usage.');

  const time = types.isDate(now) ? Date.prototype.getTime.call(now) : NaN;
  if (!Number.isFinite(time)) return deny('invalid_time', 'The evaluation time is invalid.');
  if (time >= timestamp(policy.expiresAt)) return deny('policy_expired', 'The policy has expired.');
  if (time >= expiresAt) return deny('offer_expired', 'The offer has expired.');
  if (offer.jobId !== policy.jobId) return deny('wrong_job', 'The offer is for a different job.');

  const grant = policy.grants.find(grant => grant.principalId === principalId);
  if (!grant) return deny('unknown_principal', 'The authenticated principal has no grant.');
  if (time >= timestamp(grant.expiresAt)) return deny('grant_expired', 'The principal grant has expired.');

  const supplier = policy.suppliers.find(supplier => supplier.id === offer.supplierId);
  if (!supplier || !grant.suppliers.includes(supplier.id)) {
    return deny('supplier_denied', 'The grant does not allow this supplier.');
  }
  if (offer.origin !== supplier.origin || url.origin !== supplier.origin) {
    return deny('wrong_origin', 'The offer and its URL must use the configured supplier origin.');
  }
  if (offer.payTo !== supplier.payTo) return deny('wrong_recipient', 'The offer has a different payment recipient.');
  if (offer.payer !== policy.payer) return deny('wrong_payer', 'The offer has a different payer.');
  if (offer.network !== policy.network) return deny('wrong_network', 'The offer has a different network.');
  if (offer.asset !== policy.asset) return deny('wrong_asset', 'The offer has a different asset.');
  if (amount > atomic(grant.maxPerPurchaseAtomic)) {
    return deny('purchase_limit_exceeded', 'The amount exceeds the principal limit per purchase.');
  }
  if (principalCommitted + amount > atomic(grant.maxTotalAtomic)) {
    return deny('principal_budget_exceeded', 'The amount would exceed the principal budget.');
  }
  if (jobCommitted + amount > atomic(policy.jobBudgetAtomic)) {
    return deny('job_budget_exceeded', 'The amount would exceed the shared job budget.');
  }
  return { allowed: true, code: 'allowed', explanation: 'The offer is within the grant and both budgets.', policyVersion };
}

export function renderPolicy(policy: Policy): string {
  const validated = validatePolicy(policy);
  return [
    `Policy ${validated.id} (version ${validated.version}) for job ${validated.jobId}.`,
    'Deny all purchases unless a grant allows them and the offer meets the policy terms.',
    `The shared job budget is ${validated.jobBudgetAtomic} atomic units of ${validated.asset} on ${validated.network}.`,
    `The payer is ${validated.payer}. The policy expires at ${validated.expiresAt}.`,
    'The limits include funds spent and funds held.',
    ...validated.suppliers.map(supplier =>
      `Supplier ${supplier.id} uses ${supplier.origin} and receives payment at ${supplier.payTo}.`),
    ...validated.grants.map(grant =>
      `${grant.principalId} can buy from ${grant.suppliers.join(', ')}. The limit is ${grant.maxPerPurchaseAtomic} atomic units per purchase and ${grant.maxTotalAtomic} in total. The grant expires at ${grant.expiresAt}.`),
  ].join('\n');
}
