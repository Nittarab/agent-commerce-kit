# Visual dashboard

Status: verified for replay of existing purchases. See `docs/dashboard-review.md`. The user authorized consolidation of reviewed work into private main.

## Acceptance criteria

1. A loopback dashboard reads actual local ledger state: both agents, committed/held/settled budget, delivered report, transaction links and policy refusal. It distinguishes stored facts from a current run and scripted agents from a live model.
2. A button performs the existing HTTPS protocol workflow in strict replay-only mode. No wallet provisioning, new signature issuance, new payment or arbitrary command is reachable from the UI. Missing or unfinished purchases fail closed.
3. Show structured observed runtime events for discovery, sessions, approval, price, policy, saved payment, delivery, exact retry and refusal. Do not fabricate blockchain activity or present a saved receipt as a new transfer.
4. All local mutation endpoints require same-origin checks, an unguessable page token and a single active child. The server exposes neither wallet files nor signed payloads. Child failures produce an understandable error and preserve payment state.
5. Browser QA proves the button, live progress, budget, result/receipt details, final summary and failure/empty states. Backend tests cover access checks, no duplicate run, safe projection and replay-only guard. Independent review is required.
6. Merge tested foundation, live testnet and dashboard changes into main under the user's explicit instruction. Keep repository visibility private. Preserve user-generated evidence changes.

Future scope remains separate: live AI harness, general Poppy conversations, broader wallet/SDK APIs, complete recovery operations, multichain and production deployment.
