# Private foundation review

Date: 2026-11-14. Scope: original local simulation. No real funds, signing keys, live supplier or facilitator was used.

Independent financial-control and protocol reviewers checked the ledger, controller, protocol boundaries and recovery paths. A separate verifier ran all five acceptance criteria. No blockers remained in the reviewed fixture scope.

## Findings fixed

| Finding | Final behavior and regression proof |
|---|---|
| Crash after issuance can stop progress | Reuse the saved payload and persisted fixture attempt; never sign again. Unknown or missing outcomes stay held. |
| Expiry prevents retrieval of a paid result | Exact authenticated replay precedes new-authorization time checks. New issuance still checks time. |
| Signer conflict strands a new hold | Only unissued reservations can become deferred. This frees the hold. Retry checks current budget, expiry and stop, then reserves the same order. Explicit cancellation stays terminal. |
| Stale revision approval restores old terms | Owner approval must name this operation's current order and revision. Superseded revisions and wrong-operation replacements are rejected. |
| Tool retry outlives its runtime cancellation | Client and demo propagate the cancellation signal. A submitted payment still needs recovery. |
| Delegated key can cross company/user identities | A scoped signer factory owns a fresh key and rejects another identity. |
| Poppy expiry rejects numeric timezone offsets | Accept RFC 3339 offsets, compare instants and retain original text in the operation fingerprint. |

## Evidence

- `npm run check`: type checking and all 37 tests passed.
- `npm run policy:check`: the proposed policy validates and renders.
- `npm run demo`: researcher spends 60 simulated units, reviewer spends 30, lost response recovers without a second issuance, and an extra request is refused.
- Process tests cover concurrent reservations and SIGKILL recovery.
- README installation commands were reproduced from a clean temporary copy with spaces in its path. The final source changes were then independently checked with the same validation commands.
- GitHub reported `isPrivate: true`; the npm package is private and has a publication-blocking hook.
- The source scan found no common credential signatures or reference-product branding. A scan alone cannot establish source provenance.

## Review limits

This review does not establish live NEAR payments, full Poppy conformance, x402 settlement, Eve integration, production custody or an OS sandbox. Protocol codecs and fixture controller are separate boundaries. The NEAR adapter requires trusted independently verified input. These limits are part of the README and architecture, not completed capabilities.

The branch is for private user review. No merge, open-source license or public release is authorized.
