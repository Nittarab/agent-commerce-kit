# Private foundation

Status: local simulation implemented and independently verified on 2026-11-14. All five criteria passed within the fixture scope; user review is pending. User authorized a new private repository and original policy/SDK. No public release approved.

## Scope

Build a runnable consumer: two authenticated buyer principals (researcher and reviewer) buy fixture services from one supplier, governed by one shared job budget. Typed policy, SQLite durable ledger, isolated control boundary, protocol codecs, NEAR outcome validation, bounded runtime adapter and readable demo. Policy numbers are proposed synthetic test values, not authorization to spend real funds. Preserve Poppy exact operation revisions and x402 exact terms. No full SDK/engine implementation was available in the reference skills.

## Contract

packages/core/index.ts is the shared contract. policy.evaluatePolicy is pure. Ledger authority derives from its authenticated principal argument, never an offer's self-assertion. Budget spent+held <= job cap AND principal cap; amount strings use BigInt/u128 bounds. Operation uniqueness: job+supplier+operationId; each revision immutable. At most one issued/pending/settled attempt per operation. New revisions require trusted owner approval and no unresolved previous attempt. Unknown settlement never frees budget. Signatures/receipts are not exposed in ordinary agent responses.

## Exit criteria

1. Explicit deny-by-default demo policy validates and renders plain English. Positive, boundary, malformed and refusal cases pass. Verify: npm run policy:check; npm test.
2. Independent SQLite connections/processes cannot exceed the shared cap. Restart, duplicate, changed-terms and unauthorized-principal tests pass. Verify: npm test.
3. Payment/delivery states are distinct. Simulated paid-response loss is recoverable without another signature; uncertain payment holds remain. Verify: npm test; npm run demo.
4. Poppy and x402 boundary tests reject identity/terms/revision mutations; NEAR adapter never equates outer success with token transfer success. Verify: npm test.
5. Private repository, no secrets/proprietary source, independent review, local check and reproducible README. Verify: npm run check; gh repo view --json isPrivate; review report.

## Units

- U1 core/policy + fixture policy
- U2 durable ledger and control service
- U3 Poppy/x402 boundary codecs
- U4 NEAR evidence adapter and isolated fixture signer
- U5 bounded runtime, demo, independent review and private PR

The original fixture milestone did not prove real NEAR signing or settlement. The later [live testnet milestone](live-testnet.md) now records that proof. Live Eve integration remains unimplemented. Multichain funding is deferred. No npm publish, public site, or mainnet execution.

Verification: `npm run check` passed type checking and 37 tests. Policy rendering and the demo passed. Two independent reviews reported no remaining blockers within this scope. See [review record](../review.md) for fixes and limits.
