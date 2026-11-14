# Live testnet integration

Status: implemented and independently verified for the bounded testnet scope on 2026-11-14; private user review pending. User authorizes real NEAR testnet execution and a private explanation page. No mainnet funds or public source/server deployment.

## Acceptance criteria

1. A fresh dedicated testnet payer, relayer and supplier use only faucet funds. Keys live in ignored mode-0600 files outside model/tool responses. RPC must report testnet. No mainnet endpoint is configurable.
2. A local HTTPS company implements the signed-out Poppy API profile with discovery, client metadata/JWKS, per-request sessions and Operations v3 approval. Exact request, user, revision and expiry are bound. Unsupported OAuth and general conversation features are documented.
3. The protected API responds with a real x402 v2 402 challenge. A signed NEP-366 exact ft_transfer pays wrap.testnet through a distinct relayer. Both parties verify all exact payment terms. Live calls are separate from fixture tests.
4. Durable payer and facilitator records precede network exposure. The same operation/delegate maps to one outer transaction. Retry polls or resends identical bytes; uncertain outcomes retain the budget. A final correlated inner transfer receipt gates delivery. Repeated retrieval causes no second transfer.
5. Record a real FINAL testnet transaction and verify recipient balance change. Unit tests cover tampering, wrong chain, missing approvals, persistent replay and request binding. Independent review and verification precede readiness claims.
6. A readable private/local page explains purpose, roles, payment flow, policy, testnet evidence and remaining limits. It contains no keys, bearer tokens or signed payloads.

The code and local endpoints stay private. Testnet transactions and account IDs are public blockchain data. Only fresh generated test identities are used. The first integration supports ed25519, one pinned NEP-141 contract, one supplier and one in-flight shared signer. General third-party conformance, OAuth, multichain and production custody remain outside scope.

Verification: 47 offline tests, type checking and fixture demo passed. Two FINAL testnet transfers and a zero-new-issuance restart are recorded in [evidence](../testnet-evidence.json). See [review](../live-review.md) for independent checks and explicit recovery limits.
