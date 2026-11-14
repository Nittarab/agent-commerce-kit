# Agent Commerce Kit — private prototype

An original TypeScript prototype for agents that buy services under one enforced job budget. It now includes a live NEAR testnet path: local HTTPS Poppy API approval, x402 payment headers, a signed NEP-366 transfer, a distinct gas-paying relayer and final inner receipt verification. The original fixture demo remains available for offline development.

**Private review only.** Nittarab must explicitly approve open-sourcing after review. No open-source license is assigned. The package has `private: true`, and its publication hook refuses publication. No public deployment or package publication is configured.

**Two real testnet purchases are verified.** See [testnet evidence](docs/testnet-evidence.json) and [live architecture](docs/architecture/live-testnet.md). The supplier is our local HTTPS implementation, not an independent third-party merchant. `npm run demo` still uses simulated payments. No live model or mainnet money is used. This is not a production payment service or full Poppy implementation.

## Run

Use Node 24 LTS (24.12 or newer, below 25) and npm. Implementation is on `codex/live-testnet` pending review.

```sh
git clone --branch codex/live-testnet https://github.com/Nittarab/agent-commerce-kit.git
cd agent-commerce-kit
npm ci --ignore-scripts
npm run policy:check
npm run check
npm run demo
```

The demo starts its own controller on an ephemeral loopback port in another process, creates temporary fixture databases and credentials, and removes them at exit. No credentials need to be provided. Do not put real keys in the demo.

## Live testnet and the private guide

Use the commands below only for the dedicated testnet environment. `testnet:setup` creates fresh accounts through the faucet, registers them with wrap.testnet, and wraps a small amount of faucet NEAR. It stores keys in `.local/testnet/accounts.json` with mode 0600 under an ignored mode-0700 directory. Never paste those keys into chat or commit that directory.

```sh
npm run testnet:setup
npm run testnet:run
npm run guide
```

Open the guide at http://127.0.0.1:8765. It explains the protocols, controls, flow, evidence and limits. It serves only local static files; it has no payment control. Stop it with Ctrl-C. The standalone source is [docs/site/index.html](docs/site/index.html).

The live runner starts a loopback HTTPS supplier, verifies its explicitly pinned local certificate, completes two purchases, checks exact retrieval, then stops. It does not install a system CA or disable TLS verification. OpenSSL is required to create that local certificate. The setup and runner share an exclusive lock. After a crash, verify the recorded PID is no longer running before removing `.local/testnet/running.lock`. Do not run another wallet against these dedicated keys.

Each live purchase transfers **0.000001 wrapped testnet NEAR** (1000000000000000000 atomic units). The job permits two purchases in total. Re-running uses the same operation IDs and databases; it retrieves the existing purchases rather than funding another job. Public account IDs and transaction hashes appear in the evidence, but keys and signed payloads do not. The repository and local services remain private; testnet records are public.

## The proposed fixture policy

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
| packages/poppy | Signed-out ES256 sessions, pinned discovery and exact Operations v3 API approval |
| packages/x402 | Strict v2 402 challenge parsing and exact NEAR testnet term selection |
| packages/near | Exact NEP-366 signing, testnet preflight, durable relay and correlated FINAL receipt validation |
| packages/agent | Authenticated local client and bounded pluggable model/tool loop |
| apps/control | Loopback bearer-authenticated simulator, owner stop and revision approval |
| apps/testnet | Dedicated testnet provisioning, HTTPS supplier, scoped client and live runner |
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

The live adapter uses the official NEAR SDK for domain-separated Borsh serialization and ed25519 signatures. It checks exact transfer terms, access keys, nonce, height, token balance and recipient registration against a pinned testnet RPC. The facilitator persists one signed outer transaction before sending it and inspects the correlated final token-transfer receipt. It trusts the configured RPC and wrap.testnet contract; it is not a light client. Other key curves and tokens are refused.

Poppy supports a pinned signed-out API profile with Operations v3 over local HTTPS. OAuth, PS384, browser join, general conversations and third-party interoperability certification are not implemented. x402 v2 exact NEAR transfers work in the demonstrated flow; this is our own embedded facilitator, not a public service. The live driver is a trusted deterministic harness with no model connected. Buyer, supplier and facilitator run in one process for this integration, with separate durable records. The separate fixture controller is not yet a production live-wallet boundary.

Unknown transfers remain held. A final failed transfer also remains held because a complete no-further-execution proof and operator resolution flow are not implemented. A crash after payer issuance but before the first supplier payment binding, followed by operation expiry, can prevent automatic recovery; the hold remains, and the runner must not issue a replacement. Bound attempts and paid deliveries can replay after expiry. Live policy migration, general policy syntax, receipt obligations and recurring budgets remain unimplemented.

Time limits cannot forcibly stop uncooperative code or undo an already submitted payment. Multichain swaps, bridges, production custody and deployment remain outside scope. No reference-product source or private investor material is included. See [sources](docs/sources.md).

## Visual dashboard

Run from the configured private checkout:

```sh
cd /Users/nittarab/git/private/agent-commerce-kit
npm run dashboard
```

Open http://127.0.0.1:8787. The dashboard reads the actual local ledger and shows each agent, the shared budget, delivered report and original NEAR receipt. **Run again — no new payments** starts the HTTPS workflow in strict replay-only mode and displays observed runtime events. Both purchases must already be settled and delivered. The button cannot provision accounts, issue a new signature or submit a new payment. Replay does not rewrite tracked proof files.

The server accepts only local hosts. Actions require a page token and same-origin request. Keys and signed payment bytes are not sent to the browser. If Node/RPC/locks prevent replay, the dashboard shows failure without changing payment authority. Keep the server running while using the UI; Ctrl-C stops it.

The project is not a complete agent platform. See [what is built and what comes next](docs/roadmap.md) and [dashboard verification](docs/dashboard-review.md). The foundation, live testnet integration and dashboard are consolidated in private main under the owner's instruction.
