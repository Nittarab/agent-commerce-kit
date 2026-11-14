# Sources and implementation status

Public specifications inspected 14 November 2026:

- Poppy 1.0: https://personalagentprotocol.org/docs/1.0/spec
- Poppy Operations v3: https://personalagentprotocol.org/docs/1.0/extensions/operations
- x402 v2 NEAR exact scheme, pinned source: https://github.com/x402-foundation/x402/blob/1a084343e165d6f61b60b34f6146d6e4a4a7f3ca/specs/schemes/exact/scheme_exact_near.md
- Node 24 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Node 24 native TypeScript: https://nodejs.org/docs/latest-v24.x/api/typescript.html

The code is an original small implementation of documented concepts and local fixture behavior. This repository does not contain the supplied private investor deck, reference-product code or copied implementation-kit assets. Full standards conformance is not claimed. Original source captures remain outside this repository in the user's private research workspace.

TypeScript and Node type declarations are installed as development dependencies. Their exact versions and integrity fields are in package-lock.json. Preserve their own licenses if distributing dependencies later. No public license for this project has been selected; the user must approve any open-source release.

Live integration sources checked 14 November 2026:

- Official NEAR JavaScript SDK: https://github.com/near/near-api-js (near-api-js 7.5.3, used as a dependency for serialization/signatures; its license is retained in the dependency).
- NEAR meta-transactions: https://docs.near.org/protocol/transactions/meta-tx
- Poppy Operations v3 API approval: https://personalagentprotocol.org/docs/1.0/extensions/operations
- Structured Fields parser: https://github.com/evert/structured-headers (structured-headers 2.1.1).

The two runtime dependencies above are now installed in addition to TypeScript and Node type declarations. Live test evidence is in testnet-evidence.json; offline tests never call a faucet, live facilitator or blockchain.
