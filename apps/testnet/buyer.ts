import { randomUUID } from 'node:crypto';
import type { Offer, Order, SettlementEvidence } from '../../packages/core/index.ts';
import type { Ledger } from '../../packages/ledger/index.ts';
import { purchaseService } from '../../packages/commerce/index.ts';
import type { CommerceOptions, CommerceResult } from '../../packages/commerce/index.ts';
import { createApprovalHeader } from '../../packages/poppy/index.ts';
import { operationFor } from '../../packages/poppy/live.ts';

type Progress = (step: string, message: string, status?: string, detail?: Record<string, unknown>) => void;
export type TestnetBuyerOptions = {
 principalId: string;
 offer: Offer;
 ledger: Pick<Ledger, 'lookup' | 'authorize' | 'issue' | 'deliver'>;
 replayOnly: boolean;
 transport: CommerceOptions['transport'];
 sessionHeaders: CommerceOptions['sessionHeaders'];
 loadApproval: () => string | undefined;
 saveApproval: (header: string) => void;
 /** Prepare a host-held signer only after reservation. The returned closure runs inside Ledger.issue. */
 preparePayment: (offer: Offer, signal: AbortSignal) => Promise<(order: Order) => string>;
 /** Read independently validated persisted rail evidence; never settle or broadcast from this callback. */
 inspectSettlement: (order: Order, payload: string, signal: AbortSignal) => Promise<SettlementEvidence>;
 maxTimeoutSeconds: number;
 timeoutMs?: number;
 signal?: AbortSignal;
 now?: () => number;
 progress?: Progress;
};

/** Host wiring for the runner. Protocol ordering and response verification live in the shared SDK. */
export async function purchaseTestnetService(options: TestnetBuyerOptions): Promise<CommerceResult> {
 const { principalId, ledger, replayOnly } = options;
 const offer = structuredClone(options.offer), progress = options.progress ?? (() => {});
 const original = ledger.lookup(principalId, offer), savedApproval = options.loadApproval();
 if (replayOnly && (!original || original.paymentState !== 'settled' || original.deliveryState !== 'delivered' || !original.payloadHash || !original.transactionId || !original.result || !savedApproval)) {
  throw new Error('Replay-only requires the saved approval and settled, delivered purchase');
 }
 let issuedPayload: string | undefined;
 const result = await purchaseService({
  principalId, offer, maxTimeoutSeconds: options.maxTimeoutSeconds,
  timeoutMs: options.timeoutMs, signal: options.signal, now: options.now,
  transport: options.transport, sessionHeaders: options.sessionHeaders,
  approve: async (fingerprint, signal) => {
   signal.throwIfAborted();
   progress('session', 'The supplier verified this agent’s signed Poppy session.');
   progress('approval', 'The operation and its exact terms match the approved purchase.');
   if (savedApproval) return { storedHeader: savedApproval };
   const now = options.now?.() ?? Math.floor(Date.now() / 1000);
   const header = createApprovalHeader(operationFor(offer), offer, { fingerprint, approver: 'agent', reference: randomUUID(), approvedAt: now }, 'initial', now);
   options.saveApproval(header);
   return { storedHeader: header };
  },
  authorizeAndIssue: async (_offer, signal) => {
   signal.throwIfAborted();
   progress('price', 'The x402 challenge matches the pinned token, recipient and price.');
   const authorization = ledger.authorize(principalId, offer);
   if (!authorization.order) throw new Error('Host policy refused the purchase');
   // Replay permission is checked again at the issuance boundary, not inferred from a receipt.
   if (replayOnly && (authorization.kind !== 'replay' || authorization.order.id !== original!.id || !authorization.order.payloadHash)) throw new Error('Replay cannot authorize a new payment');
   progress('policy', authorization.kind === 'replay' ? 'Policy found the same recorded purchase. No new budget is reserved.' : 'Policy allowed and reserved this purchase.');
   const reused = Boolean(authorization.order.payloadHash);
   const build = replayOnly || reused ? () => { throw new Error('Existing issuance must be reused'); } : await options.preparePayment(structuredClone(offer), signal);
   signal.throwIfAborted();
   const issued = ledger.issue(principalId, authorization.order.id, build);
   issuedPayload = issued.payload;
   progress('payment', reused ? 'Reusing the saved payment authorization. No new signature.' : 'Payment authorization stored before sending.', reused ? 'reused' : 'complete');
   return issued;
  },
  verifySettlement: async ({ order }, signal) => {
   signal.throwIfAborted();
   if (!issuedPayload) throw new Error('No saved payment authorization');
   return options.inspectSettlement(order, issuedPayload, signal);
  },
  deliver: async (id, text, signal) => {
   signal.throwIfAborted();
   const delivered = ledger.deliver(principalId, id, text);
   progress('delivery', 'The paid report matches independently verified FINAL settlement and was saved.');
   return delivered;
  },
 });
 progress('retry', 'A second request returned the identical report and payment receipt. No second payment.', 'complete', { transactionId: result.transactionId });
 return result;
}
