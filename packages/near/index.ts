import { atomic } from '../core/index.ts';
import type { Order, SettlementEvidence } from '../core/index.ts';

/** Facts independently verified by the caller's NEAR adapter for this transaction.
 *  This includes decoding the executed delegate, checking its signature, binding
 *  its exact bytes to the order payload, and identifying the receipts it created.
 */
export type VerifiedNearTransfer = {
  transactionId: string;
  network: 'near:testnet';
  payloadHash: string;
  relayer: string;
  delegateReceiptId: string;
  transferReceiptId: string;
  payer: string;
  publicKey: string;
  asset: string;
  payTo: string;
  amountAtomic: string;
  actionCount: 1;
  methodName: 'ft_transfer';
  deposit: '1';
  /** Independent proof that no other attempt succeeded or can still execute. */
  noFurtherExecution?: true;
};

export type NearSettlementInput = {
  order: Order;
  expectedPublicKey: string;
  /** Trusted NEAR tx result for the configured testnet, obtained with wait_until FINAL. */
  rpc: unknown;
  verifiedTransfer?: VerifiedNearTransfer;
};

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function hasStatus(value: unknown, key: string): boolean {
  const status = record(value);
  return Object.keys(status).length === 1 && Object.hasOwn(status, key);
}

function receiptOutcome(receipts: unknown[], id: string, executor: string) {
  const matches = receipts.map(record).filter(receipt => receipt.id === id);
  const outcome = record(matches[0]?.outcome);
  if (matches.length === 1 && outcome.executor_id === executor) return outcome;
  return {};
}

function hasChild(outcome: Record<string, unknown>, id: string): boolean {
  return Array.isArray(outcome.receipt_ids) && outcome.receipt_ids.includes(id);
}

export function inspectNearSettlement({
  order,
  expectedPublicKey,
  rpc,
  verifiedTransfer: transfer,
}: NearSettlementInput): SettlementEvidence {
  const { network, asset, payer, payTo, amountAtomic } = order.offer;
  const result = record(rpc);
  const transaction = record(result.transaction);
  const transactionId = typeof transaction.hash === 'string' ? transaction.hash : '';
  const evidence: SettlementEvidence = {
    orderId: order.id, payloadHash: order.payloadHash ?? '', transactionId,
    network, asset, payer, payTo, amountAtomic,
    final: false, outcome: 'unknown', noFurtherExecution: false,
  };
  try {
    atomic(amountAtomic);
  } catch {
    return evidence;
  }
  if (network !== 'near:testnet' || result.final_execution_status !== 'FINAL'
    || !transfer || !order.payloadHash || !/^[a-f0-9]{64}$/.test(order.payloadHash)
    || (order.transactionId !== undefined && order.transactionId !== transactionId)
    || !transactionId || transfer.transactionId !== transactionId
    || transfer.payloadHash !== order.payloadHash || transfer.network !== network
    || !expectedPublicKey || transfer.publicKey !== expectedPublicKey
    || !payer || !asset || !payTo || transfer.payer !== payer || transfer.asset !== asset
    || transfer.payTo !== payTo || transfer.amountAtomic !== amountAtomic
    || transfer.actionCount !== 1 || transfer.methodName !== 'ft_transfer' || transfer.deposit !== '1'
    || !transfer.relayer || transfer.relayer === payer || transaction.signer_id !== transfer.relayer
    || transaction.receiver_id !== payer
    || !transfer.delegateReceiptId || !transfer.transferReceiptId
    || new Set([transactionId, transfer.delegateReceiptId, transfer.transferReceiptId]).size !== 3
    || !Array.isArray(result.receipts_outcome)) return evidence;

  const outer = record(result.transaction_outcome);
  const outerOutcome = record(outer.outcome);
  const delegate = receiptOutcome(result.receipts_outcome, transfer.delegateReceiptId, payer);
  const inner = receiptOutcome(result.receipts_outcome, transfer.transferReceiptId, asset);
  if (outer.id !== transactionId || outerOutcome.executor_id !== transfer.relayer
    || !hasStatus(outerOutcome.status, 'SuccessReceiptId')
    || record(outerOutcome.status).SuccessReceiptId !== transfer.delegateReceiptId
    || !hasChild(outerOutcome, transfer.delegateReceiptId)
    || !hasStatus(delegate.status, 'SuccessValue') || record(delegate.status).SuccessValue !== ''
    || !hasChild(delegate, transfer.transferReceiptId)) return evidence;

  if (hasStatus(inner.status, 'SuccessValue') && typeof record(inner.status).SuccessValue === 'string') {
    return { ...evidence, final: true, outcome: 'success' };
  }
  const failure = record(inner.status).Failure;
  if (hasStatus(inner.status, 'Failure') && Object.keys(record(failure)).length > 0) {
    return {
      ...evidence,
      final: true,
      outcome: 'failure',
      noFurtherExecution: transfer.noFurtherExecution === true,
    };
  }
  return evidence;
}
