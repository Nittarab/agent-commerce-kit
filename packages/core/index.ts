import { createHash } from 'node:crypto';

export type Supplier = { id: string; origin: string; payTo: string };
export type Grant = { principalId: string; suppliers: string[]; maxPerPurchaseAtomic: string; maxTotalAtomic: string; expiresAt: string };
export type Policy = { id: string; version: string; jobId: string; network: 'near:testnet'; asset: string; payer: string; jobBudgetAtomic: string; expiresAt: string; suppliers: Supplier[]; grants: Grant[] };
export type Offer = { operationId: string; revision: string; jobId: string; supplierId: string; origin: string; method: string; url: string; bodyHash: string; network: string; asset: string; payer: string; payTo: string; amountAtomic: string; expiresAt: string };
export type Usage = { jobCommittedAtomic: string; principalCommittedAtomic: string };
export type Decision = { allowed: boolean; code: string; explanation: string; policyVersion: string };
export type PaymentState = 'reserved' | 'issued' | 'pending' | 'settled' | 'failed' | 'cancelled';
export type DeliveryState = 'not_delivered' | 'delivered';
export type Order = { id: string; principalId: string; offer: Offer; fingerprint: string; policyVersion: string; paymentState: PaymentState; deliveryState: DeliveryState; payloadHash?: string; transactionId?: string; result?: { digest: string; text: string }; createdAt: string };
export type SettlementEvidence = { orderId: string; payloadHash: string; transactionId: string; final: boolean; outcome: 'success' | 'failure' | 'unknown'; network: string; asset: string; payer: string; payTo: string; amountAtomic: string; noFurtherExecution: boolean };

export function atomic(value: unknown, allowZero = false): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value)) throw new Error('Amount must be a canonical unsigned decimal string');
  const result = BigInt(value);
  if (result > (1n << 128n) - 1n || (!allowZero && result === 0n)) throw new Error('Amount is out of range');
  return result;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  }
  throw new Error('Only plain JSON values and safe integers can be canonicalized');
}
export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function fingerprint(value: unknown): string { return sha256(canonical(value)); }
export function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error('Timestamp must be UTC ISO-8601');
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString().replace('.000Z','Z') !== value.replace('.000Z','Z')) throw new Error('Invalid timestamp');
  return result;
}
