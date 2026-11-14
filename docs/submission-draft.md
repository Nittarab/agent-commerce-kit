# Submission draft — owner review only

Nothing in this document has been published or submitted. Finalize the exact name, tracks, public repository, video post and identity with the owner. The current repository remains private.

## Proposed positioning

**Agent Commerce Kit** — the building blocks for agents to buy work from other agents.

The memorable claim: **Agents can retry a task without buying it twice, and uncertainty cannot silently replenish their budget.** The peer network makes paid work visible. Lead with agents requesting and delivering services, then show the wallet, facilitator, protocols and financial guarantees underneath.

Suggested primary track: AI Security & Defense (`security`). Secondary: Agent Economy (`agents`). Add AI Swarms (`swarms`) only with the explicit scripted-fixture scope below. No live model, autonomous bidding, multichain or production-custody claims.

## “What did you build?” draft

Agents buying services need a spending boundary that survives retries, races and ambiguous payment outcomes. Agent Commerce Kit is an original TypeScript prototype that binds an approved operation to agent authority, an atomic shared-budget reservation, one payment attempt and an immutable delivered result.

Our local visual lab runs 12 scripted buyers against three fixture services. It exercises the actual policy engine and SQLite ledger, showing permitted purchases, policy refusals, exact retries and money held after an uncertain outcome. All swarm transfers are explicitly simulated.

A separate integration completes Poppy API approval and x402 exact payments using real wrapped NEAR testnet transfers through NEP-366 meta-transactions. Two purchases have recorded transaction and inner-receipt evidence. Replaying them retrieves the original results with no new issuance or transfer.

NEAR provides the verifiable settlement rail; the control layer decides whether an agent is authorized to spend before a payment is issued. The prototype uses our local supplier and embedded facilitator, not a public third-party marketplace. It has no live LLM, Intents/bridge integration or production custody. The reusable modules and failure-focused demo are the foundation for safer agent commerce.

## X post draft

Agents should retry tasks, not buy them twice.

Built Agent Commerce Kit at NEAR HACKATHON: shared budgets, safe retries and uncertain-payment holds. A simulated swarm makes the controls visible; separate purchases settle on NEAR testnet.

@NEARProtocol #NEARHackathon

Attach the video; link the public repository in the post or a follow-up. This draft is under 280 characters before adding a URL. The owner publishes it.

## 90-second demo script

Use the final verified build. Keep “simulated transactions” visible in the swarm scenes. Avoid terminal setup, slides and unobserved claims. If a run fails, show the actual error or re-record; do not replace real outcomes with fabricated animation.

| Time | Action on screen | Voiceover |
|---|---|---|
| 0–10 s | Open Swarm lab, select Service marketplace and start at fast tempo | “An agent that retries a request can accidentally pay twice. A group of agents can also exhaust one shared wallet. This is the spending boundary we built.” |
| 10–25 s | Follow a direct buyer-to-seller request to a fixture result; select its row | “Twelve scripted buyers request three services. These swarm payments are simulated, but every decision comes from our policy engine and SQLite ledger.” |
| 25–37 s | Filter refusals and select an unauthorized-recipient or per-purchase-limit refusal | “An agent cannot change the approved recipient or bypass its spending limit. The reason is visible, with the exact request.” |
| 37–48 s | Filter safe retries; inspect the repeated operation | “Retry returns the same order and result. It does not issue another payment.” |
| 48–62 s | After the run completes, start Tight shared budget; show committed budget and refusals | “All agents share one cap. Held and paid amounts both count, so concurrent work cannot pretend the same money is available twice.” |
| 62–75 s | Start Uncertain payment after the prior run finishes; select held event | “When settlement is unknown, the money stays held and the shared signer stops. A timer is not proof that a payment failed.” |
| 75–87 s | Open NEAR purchases, select a saved report and real transaction link | “This separate path made two real wrapped-NEAR testnet payments through Poppy approval and x402. The original transfers verified their final inner receipts. Replaying retrieves the paid report without buying again.” |
| 87–90 s | End on clear result/receipt view | “A visible, testable spending boundary for agent commerce.” |

If the UI cannot complete all three scenarios within the time, use two short cuts between completed runs; keep simulation labels and event details visible. Prefer a clear 90–120 second real recording over a rushed misleading cut.

## Owner packet before submission

Prepare these together, without committing personal data:

- Exact project name and selected tracks.
- Lead name, contact email and team-size choice.
- Mainnet NEAR prize account supplied by the owner.
- Owner-approved public repository and chosen license.
- Public X video URL, published by the owner.
- Final description above, updated only to match verified behavior.
- Contact-notice consent and confirmation that this project has not already been submitted.

The official form is [nearhackathon.com/#apply](https://nearhackathon.com/#apply). For the API, follow the current [submission contract](https://nearhackathon.com/HACKATHON.md): do not send a placeholder payload, do not add the `website` honeypot field, and retain one request ID for any authorized retry. The final response must establish successful submission; preparing this draft is not submission.
