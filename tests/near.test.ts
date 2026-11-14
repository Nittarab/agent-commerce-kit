import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../packages/core/index.ts';
import type { Order } from '../packages/core/index.ts';
import { inspectNearSettlement } from '../packages/near/index.ts';
import type { VerifiedNearTransfer } from '../packages/near/index.ts';
import { FixtureSigner } from '../packages/wallet/index.ts';

const offer = {
  operationId: 'lookup', revision: '1', jobId: 'research', supplierId: 'supplier',
  origin: 'https://supplier.example', method: 'POST', url: 'https://supplier.example/lookup',
  bodyHash: sha256('request'), network: 'near:testnet', asset: 'token.testnet',
  payer: 'buyer.testnet', payTo: 'supplier.testnet', amountAtomic: '15',
  expiresAt: '2026-11-14T23:00:00Z',
};
const order: Order = {
  id: 'order-1', principalId: 'researcher', offer, fingerprint: sha256('offer'),
  policyVersion: '1', paymentState: 'issued', deliveryState: 'not_delivered',
  createdAt: '2026-11-14T22:30:00Z', payloadHash: sha256('SIMULATED:payload'),
};
const expectedPublicKey = 'fixture-key';
const verifiedTransfer: VerifiedNearTransfer = {
  network: 'near:testnet', transactionId: 'tx-hash', payloadHash: order.payloadHash!,
  relayer: 'relay.testnet', payer: offer.payer, publicKey: expectedPublicKey,
  asset: offer.asset, payTo: offer.payTo, amountAtomic: offer.amountAtomic,
  delegateReceiptId: 'delegate-receipt', transferReceiptId: 'transfer-receipt',
  actionCount: 1, methodName: 'ft_transfer', deposit: '1',
};
const transaction = {
  hash: 'tx-hash', signer_id: 'relay.testnet', receiver_id: offer.payer,
};
const transactionOutcome = {
  id: 'tx-hash',
  outcome: { executor_id: 'relay.testnet', status: { SuccessReceiptId: 'delegate-receipt' }, receipt_ids: ['delegate-receipt'] },
};
const delegateReceipt = {
  id: 'delegate-receipt',
  outcome: { executor_id: offer.payer, status: { SuccessValue: '' }, receipt_ids: ['transfer-receipt'] },
};
const transferReceipt = {
  id: 'transfer-receipt',
  outcome: { executor_id: offer.asset, status: { SuccessValue: '' }, receipt_ids: [] },
};
const rpc = {
  final_execution_status: 'FINAL', transaction, transaction_outcome: transactionOutcome,
  status: { SuccessValue: '' }, receipts_outcome: [delegateReceipt, transferReceipt],
};
const validInput = { order, expectedPublicKey, rpc, verifiedTransfer };

test('binds the final token transfer to the issued order', () => {
  const evidence = inspectNearSettlement(validInput);
  assert.deepEqual(evidence, {
    orderId: order.id, payloadHash: order.payloadHash, transactionId: transaction.hash,
    network: offer.network, asset: offer.asset, payer: offer.payer, payTo: offer.payTo,
    amountAtomic: offer.amountAtomic, final: true, outcome: 'success', noFurtherExecution: false,
  });
});

test('keeps outer success, pending execution, or uncorrelated receipts unknown', () => {
  const responses = [
    { ...rpc, receipts_outcome: [delegateReceipt] },
    { ...rpc, receipts_outcome: [transferReceipt] },
    { ...rpc, receipts_outcome: [delegateReceipt, transferReceipt, transferReceipt] },
    { ...rpc, final_execution_status: 'EXECUTED_OPTIMISTIC' },
    { ...rpc, receipts_outcome: [delegateReceipt, {
      ...transferReceipt, outcome: { ...transferReceipt.outcome, status: 'Unknown' },
    }] },
    { ...rpc, receipts_outcome: [delegateReceipt, {
      ...transferReceipt, outcome: { ...transferReceipt.outcome, executor_id: 'other.testnet' },
    }] },
    { ...rpc, transaction_outcome: {
      ...transactionOutcome, outcome: { ...transactionOutcome.outcome, receipt_ids: ['other-receipt'] },
    } },
    { ...rpc, transaction: { ...transaction, signer_id: 'wrong.testnet' } },
    { ...rpc, transaction: { ...transaction, hash: 'other-hash' } },
    null,
  ];
  for (const response of responses) {
    const evidence = inspectNearSettlement({ ...validInput, rpc: response });
    assert.equal(evidence.outcome, 'unknown');
    assert.equal(evidence.final, false);
    assert.equal(evidence.noFurtherExecution, false);
  }
  assert.equal(inspectNearSettlement({ ...validInput, verifiedTransfer: undefined }).outcome, 'unknown');
});

test('rejects changes to action terms or order binding', () => {
  const mutations: Partial<VerifiedNearTransfer>[] = [
    { amountAtomic: '16' }, { payTo: 'other.testnet' }, { asset: 'other.testnet' },
    { publicKey: 'other-key' }, { payer: 'other.testnet' }, { payloadHash: sha256('other') },
    { transactionId: 'other-hash' }, { transferReceiptId: 'other-receipt' },
  ];
  for (const mutation of mutations) {
    const evidence = inspectNearSettlement({
      ...validInput, verifiedTransfer: { ...verifiedTransfer, ...mutation },
    });
    assert.equal(evidence.outcome, 'unknown', JSON.stringify(mutation));
  }
  assert.equal(inspectNearSettlement({
    ...validInput, order: { ...order, transactionId: 'other-hash' },
  }).outcome, 'unknown');
});

test('a final inner failure alone does not exclude execution in a different transaction', () => {
  const failedRpc = { ...rpc, receipts_outcome: [delegateReceipt, {
    ...transferReceipt,
    outcome: { ...transferReceipt.outcome, status: { Failure: { ActionError: {} } } },
  }] };
  const failure = inspectNearSettlement({ ...validInput, rpc: failedRpc });
  assert.equal(failure.outcome, 'failure');
  assert.equal(failure.final, true);
  assert.equal(failure.noFurtherExecution, false);
  assert.equal(inspectNearSettlement({
    ...validInput, rpc: failedRpc, verifiedTransfer: { ...verifiedTransfer, noFurtherExecution: true },
  }).noFurtherExecution, true);
});

test('fixture signing produces opaque deterministic, order-bound simulated payloads', () => {
  const signer = new FixtureSigner();
  const payload = signer.sign(order);
  assert.match(payload, /^SIMULATED:[a-f0-9]{64}$/);
  assert.equal(signer.sign(order), payload);
  assert.notEqual(signer.sign({ ...order, id: 'order-2' }), payload);
  assert.notEqual(signer.sign({ ...order, offer: { ...offer, amountAtomic: '16' } }), payload);
  assert.throws(() => signer.sign({ ...order, paymentState: 'cancelled' }));
  assert.throws(() => signer.sign({ ...order, offer: { ...offer, network: 'near:mainnet' } }));
});
