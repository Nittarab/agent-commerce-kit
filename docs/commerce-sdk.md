# Pinned service buyer SDK

`packages/commerce/index.ts` exports `purchaseService(options)`, `CommerceError`, and the request, response, approval and result types. It turns the existing Poppy Operations v3 API and x402 exact NEAR testnet flow into a reusable host-side client.

The sequence is: fetch the pinned operation → validate its exact terms → obtain host approval → validate the exact 402 price → atomically reserve and issue through the host → pay → independently verify settlement → repeat the identical payment to verify immutable retrieval → persist delivery. A successful HTTP response alone never counts as settlement.

## Host integration

```ts
import { purchaseService } from '../packages/commerce/index.ts';

const result = await purchaseService({
  principalId,              // authenticated by the host, outside model control
  offer,                    // configured exact supplier, origin, URL and payment terms
  maxTimeoutSeconds: 600,   // must equal the accepted x402 requirement
  transport,               // pinned TLS GET transport; no redirects, bounded response size
  sessionHeaders,          // create a fresh Poppy-Session for every request
  approve,                 // approve the exact operation fingerprint using host policy
  authorizeAndIssue,       // atomic budget reservation + durable exact payload reuse
  verifySettlement,        // independent chain/authoritative persisted settlement evidence
  deliver,                 // ledger persistence of immutable text and digest
  timeoutMs: 60_000,
});
// Caller fields: orderId, operationId, transactionId, result, digest.
// result is raw untrusted supplier data. Schema-select/redact it before model use;
// a supplier could echo credentials into its response body.
```

These functions are required adapters, not globals supplied by this package. `authorizeAndIssue(offer, signal)` returns `{ order, payload }`; the order must bind the authenticated principal and exact offer, and its payload hash must match. Use the existing ledger's atomic reservation and durable issuance behavior. Keep its signer, keys and actor authentication outside the model's context. Neither supplier operation metadata nor model output can change the host's pinned terms.

`verifySettlement({ order, payloadHash, receipt }, signal)` returns a `SettlementEvidence` after independently inspecting the chain or trusted persisted settlement. Do not implement it by copying the merchant receipt into evidence. The SDK matches final success, transaction ID, order, payload hash, network, asset, payer, recipient and amount before allowing delivery. `deliver(orderId, text, signal)` must return the persisted settled/delivered order with matching transaction, payload hash, result bytes and digest.

`approve(fingerprint, signal)` returns `{ approver: 'agent', reference, approvedAt }` for this host-approved API profile, or `{ storedHeader }` for an existing exact approval. The latter supports immutable retrieval after offer expiry. It does not authorize a new expired payment: the host must distinguish a previously issued exact attempt from fresh authorization and reject the latter. The package intentionally does not acquire approval from a model.

## Failure and recovery

All adapter calls receive an abort signal. The SDK rejects when its timeout or caller cancellation fires, even if an adapter does not cooperate. Adapters must still honor cancellation before irreversible work and persist outcomes: a timed-out callback may otherwise finish after the caller stops waiting.

`CommerceError.stage` identifies the failed stage without exposing adapter error text, signed payloads, session credentials or keys. There is no automatic refund, release, new payment, endpoint discovery, wallet funding or retry with different terms. Retain issued and uncertain spend, and recover using the same operation and durable payload. A failure during receipt verification, repeated retrieval or delivery can occur after an actual payment succeeded.

## Scope and evidence

This module implements only the pinned GET API profile used by this repository: Poppy operations/approval and exact NEAR testnet x402 requirements. It does not implement general Poppy conversations, discovery, delegation or cross-chain swaps. Receipt fields and immutable replay behavior intentionally match the repository's supplier profile.

The transport must enforce its configured TLS/origin trust, reject redirects before following them, limit response bytes and honor cancellation. The client never follows arbitrary links from 403 metadata. Authorization, persistent recovery, session creation, signing and actual network settlement remain host adapter responsibilities.

`tests/commerce.test.ts` uses the real operation/challenge codecs with simulated in-memory ledger, signer, rail and transport. It exercises successful immutable replay, changed terms, missing/mismatched receipts, unproven settlement, changed retrieval, redirect refusal, credential filtering, safe errors and timeouts. These fixture tests perform no live calls and do not prove x402 settlement or complete Poppy conformance.
