# What is built and what comes next

The full agent commerce product is not finished. The working slice is two scripted buyers, a local supplier, enforced budgets, exact approvals, real testnet transfers and safe repeat retrieval. All source remains private until Nittarab approves release.

| Original building block | Current state | Remaining work |
|---|---|---|
| Wallet | Fresh testnet accounts; host-held ed25519 key; exact transfer signing; distinct gas relayer | Reusable wallet adapter interface, external wallet/key services, user account management |
| Policy | Typed JSON, supplier/token/recipient restrictions, per-purchase/agent/shared limits, expiry, durable reservations and audit events | Owner policy editor, migration preserving totals, more policy rules and an operator recovery path |
| Agent harness | Bounded model/tool interface; scripted agents run the verified flow | Connect a live model or Eve/Weft harness, accept a real user task, choose tools, inspect outputs and stop safely |
| Poppy interchange | Signed-out ES256 API sessions and exact Operations v3 approval over local HTTPS | General conversations and events, OAuth, remote-company discovery trust and independent interoperability tests |
| x402 | Real v2 exact NEAR token payment and response headers through our local embedded facilitator | General merchant/client adapters, independent facilitator interoperability and service catalog |
| NEAR | Real testnet NEP-366 transfers with exact preflight, durable transaction identity and correlated final receipts | Complete failed-payment reconciliation, external key isolation, production review and operational controls |
| Visual application | Local dashboard reads real records and runs the existing purchases in replay-only mode | User-driven new jobs, owner approval UI, policy editing and recovery operations |
| Multichain | Not implemented | NEAR Intents/swaps/bridges after the single-chain product is complete; each live financial integration needs its own scope and approval |
| SDK distribution | Separate TypeScript modules in the private repository | Stable package entry points, small documented public interfaces and integration examples; no package publication authorized |

## Recommended order

1. Connect the bounded harness to a live model and one useful service. Show a user entering a task and the agent requesting a paid action under policy. Keep keys outside the model.
2. Implement Poppy conversations so one agent can request a service from another and follow its progress. Verify the same approval/payment/delivery boundaries across separate processes.
3. Extract and stabilize the wallet, policy, agent and protocol SDK interfaces from that complete task flow.
4. Add the owner controls: review a proposed purchase, edit a policy safely, and investigate held or failed payments.
5. Add multichain funding after the above flow is reliable. Do not treat a successful testnet transfer as evidence for bridges or mainnet custody.

Open-sourcing is a separate user review gate. Consolidating into private main does not change visibility or authorize a release.
