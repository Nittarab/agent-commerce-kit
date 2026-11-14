# Agent Commerce Kit — private prototype

An original TypeScript prototype for two agents that buy fixture services under one enforced job budget. A separate local control process holds policy, reservations and simulated signing. Poppy and x402 codecs check identity and payment terms. The NEAR adapter checks correlated settlement evidence supplied by a trusted caller.

**Private review only.** Nittarab must explicitly approve open-sourcing after review. No open-source license is assigned. The package has `private: true`, and its publication hook refuses publication. No public deployment or package publication is configured.

**All payments and supplier responses in the demo are simulated.** No real NEAR transaction, funded wallet, facilitator or live model is called. This is a working control prototype, not a production payment service or full Poppy implementation.

## Run

Use Node 24 LTS (24.12 or newer, below 25) and npm. Implementation is on `codex/private-foundation` pending review.

```sh
git clone --branch codex/private-foundation https://github.com/Nittarab/agent-commerce-kit.git
cd agent-commerce-kit
npm ci --ignore-scripts
npm run policy:check
npm run check
npm run demo
```

The demo starts its own controller on an ephemeral loopback port in another process, creates temporary fixture databases and credentials, and removes them at exit. No credentials need to be provided. Do not put real keys in the demo.

## The proposed policy

`policies/demo.json` is a synthetic example, not permission to spend real funds.

| Control | Demo value |
|---|---|
| Shared job budget | 100 atomic fixture-token units |
| Researcher | At most 70 per purchase and 70 in total |
| Reviewer | At most 40 per purchase and 40 in total |
| Supplier | Only fixture-supplier at the exact configured HTTPS origin |
| Recipient / payer | supplier.testnet / buyer.testnet |
| Network / asset | near:testnet / demo-token.testnet, both fixture labels |
| Expiry | 2030-01-01 UTC; new payment issuance checks time again |
| Unknown settlement | Keep the hold; never free it because a request timed out |
| Revised offer | Trusted owner approval of the expected current revision |
| Defaults | Refuse malformed, unsupported or ungranted operations |

Limits include held and settled amounts, use integer arithmetic and allow landing exactly on a cap. Each agent cap is independent; the two grants do not increase the shared 100-unit cap. Model inference charges are not included in this token budget.

The demonstration spends 60 units on research and 30 on review. It drops the first HTTP response after simulated payment, retrieves the same order without another issuance, verifies the artifact digest, and refuses another purchase. A separate test starts two real processes racing to reserve 70 and 40 against the same 100 budget. Another kills a process after submission and checks recovery from the persisted state.

## Modules

| Path | Implemented responsibility |
|---|---|
| packages/core | Types, canonical hashes, strict atomic amounts and timestamps |
| packages/policy | Strict config validation, deterministic decisions and English rendering |
| packages/ledger | SQLite transactions, shared holds, revisions, immutable deliveries and audit chain |
| packages/wallet | Simulated signer and durable simulated rail status |
| packages/poppy | Signed-out ES256 session subset, pinned discovery, exact operation approvals |
| packages/x402 | Strict v2 402 challenge parsing and exact NEAR testnet term selection |
| packages/near | Validate a final, correlated inner transfer outcome; no network/signing implementation |
| packages/agent | Authenticated local client and bounded pluggable model/tool loop |
| apps/control | Loopback bearer-authenticated simulator, owner stop and revision approval |
| examples/shared-budget | Runnable three-role simulation with researcher, reviewer and supplier fixture |

The two workers act for one owner. Each has its own token and Poppy session. The supplier fixture is deterministic; the model adapter in this demo is scripted. Independent verification means separate checking code, not a different data provider.

## What the tests establish

- Per-call, principal and job caps, including concurrent processes.
- Authenticated principal isolation and rejection of owner-privilege injection.
- Exact-term replay, immutable revision terms, and stale or wrong-operation owner approval rejection.
- Retry after a temporary signer block, with fresh budget, expiry and stop checks; explicit cancellation stays terminal.
- Signed payload persistence before exposure, held funds after an unknown outcome, process-kill recovery and no repeat issuance.
- Final settlement distinct from delivery; lost-response recovery and immutable artifacts.
- Session scope, JWT mutation, expiry, operation approval and payment requirement checks.
- Outer NEAR transaction success alone is not accepted as inner token-transfer success.

Read [architecture and trust boundaries](docs/architecture/system.md), the [behavior reconstruction](docs/behavior-map.md) and the [acceptance specification](docs/specs/private-foundation.md).

## Limits before any real payment

The control process is separate, but the demo does not create an OS sandbox. A hostile process with the same filesystem permissions can read or alter its databases. The hash-linked audit log detects ordinary edits when checked against a retained head; it is not tamper-proof against its administrator. Actor tokens must remain outside model context.

The NEAR module assumes trusted RPC and already-verified decoded transfer context. It does not fetch RPC, decode and verify actual NEP-366 signatures, sponsor gas, broadcast, or operate a facilitator. A live adapter must prove all of those steps, use durable transaction lookup, register token storage where required, and correlate the exact inner receipt. Fake evidence must never enter that trusted adapter boundary.

The Poppy subset uses pinned fixture identities. OAuth, PS384 delegations, browser join, remote discovery, stateful conversations and full conformance are not implemented. The demo validates Poppy fixtures locally; its internal controller uses HTTP on loopback and is not a Poppy server. x402 payment signing and HTTP resource settlement are unimplemented. The bounded runtime accepts a model adapter; no Eve or live-model adapter is connected yet.

Time limits abort waiting and pass a cancellation signal. They cannot forcibly stop uncooperative arbitrary code or undo a payment already submitted. Stop prevents new issuance, not settlement of an existing signed attempt. Unknown transfers remain held until an authoritative adapter resolves them. Live policy migration, receipt obligations, recurring time-window budgets and a general policy language are not implemented.

Multichain swaps, bridges, production custody and deployment are outside this prototype. No source from another policy engine or private investor material is included. Public standards and the owner's prior design patterns informed this original code. See [sources](docs/sources.md).
