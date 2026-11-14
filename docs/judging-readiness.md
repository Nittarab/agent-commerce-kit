# Judge readiness — private review packet

Checked 15 November 2026, Zurich time. Working review target: **00:34**. Submission cutoff: **00:59** (14 November 23:59 UTC). This is a readiness assessment, not a prediction of winning.

## What the organizers actually assess

The current site says automated screening checks whether the project runs and matches its README; human judges decide. It names implementation, design, impact, originality and sustainability as guidance from earlier events, without publishing current numeric weights. Do not present a homemade score as the official rubric. [Official FAQ](https://nearhackathon.com/#faq)

Recommended tracks: **AI Security & Defense (`security`) first**, **Agent Economy (`agents`) second**. The strongest demonstrated feature is enforceable spending authority with exact replay and uncertain-payment holds. AI Swarms (`swarms`) is defensible as a scripted coordination demonstration after validation, but not as autonomous negotiation or a live multi-agent on-chain economy. [Official tracks](https://nearhackathon.com/#tracks)

The security example emphasizes blocking unauthorized payment attempts; its function-call-key design is an example, not something this kit implements. [Official security example](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md)

The swarm example explicitly includes scripted strategies without LLM calls, alongside a visible market. That supports a clearly labelled simulation, but does not establish that our fixed service requests implement its bidding or group-buying behavior. [Official swarm example](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/05-swarms.md)

## Entry requirements and review gates

The [official participation guide](https://nearhackathon.com/HACKATHON.md) permits testnet-only projects and local demos. A local-only entry needs a public X **video**, a public repository with reproducible instructions, and a license file. Screenshots alone do not suffice when judges cannot open the app. The repository must stay public through judging. Named integrations are suggestions, not mandatory. Code since 19 October is eligible; earlier work is baseline. Each person can enter up to two independent, mutually disclosed projects.

| Gate | Current status | Required action |
|---|---|---|
| Public repository | **Blocked by intentional privacy** | Owner reviews exact content, then explicitly authorizes visibility change. Keep private until then. |
| License file | **Not selected** | Owner chooses before release; do not assign a license autonomously. |
| Public demo video on X | **Not established** | Record the working UI; owner posts with event attribution, @NEARProtocol and #NEARHackathon. |
| Submission data | **Not established** | Owner supplies lead, email, team size and mainnet prize account, and confirms project name/tracks. Never use a testnet wallet as payout. |
| Contact consent | **Not established** | Owner accepts the form's exact contact notice. |
| One final submission | **Not established** | Check whether already submitted, inspect final payload, obtain owner confirmation, then submit once. |
| Public deployment | **Not necessary for local entry** | A video plus reproducible repo is the faster route; no deployment authorized. |

These publication gates come from the owner's privacy instruction and the documented entry requirements. The deadline does not override them. No submission has been sent by this review task.

## Evidence matrix

| Dimension | Strongest evidence to show | Honest limitation / final check |
|---|---|---|
| Runs as described | `npm ci --ignore-scripts`, `npm run check`, `npm run demo`, then `npm run dashboard` | README must point to the final branch/commit and portable paths. Reproduce from a clean checkout. |
| Policy correctness | Per-purchase, principal and shared caps; competing-process reservation test; denied recipient | Policy is enforced in a trusted local process, not a contract or OS sandbox. |
| Retry safety | Repeat retrieval gives the same paid result; issuance count stays unchanged | Do not equate every retry or timeout with a safe refund. |
| Uncertain spend | Swarm uncertain scenario retains holds and blocks shared signer | Simulation tests the invariant; no complete live operator reconciliation UI. |
| NEAR use | Two recorded wrapped-testnet-NEAR transfers; exact NEP-366 terms and final inner receipt validation | Real testnet integration uses our local merchant/facilitator. No Intents, bridge or mainnet support. |
| Protocol use | Pinned Poppy API session/approval plus x402 exact NEAR path | Not general Poppy conversations or independent interoperability certification. |
| Design | Inspectable nodes, observed event stream, refusals, results and held-budget display | Swarm UI is a new increment: only mark passed after browser QA and independent review. |
| Originality | One boundary binds agent authority, approved operation, reserved budget, payment and immutable delivery | Do not claim “first,” uniqueness against every entry, or copied reference technology. |
| Impact | Agent builders can diagnose spending failures before enabling a real wallet | No customer adoption or measured business impact demonstrated. |
| Sustainability | Small typed modules, offline reproduction, documented trust boundaries | SDK packaging, external key isolation, live model and operations remain future work. |

Existing dashboard milestone evidence: [review](dashboard-review.md), [testnet records](testnet-evidence.json), [architecture](architecture/live-testnet.md), [roadmap](roadmap.md). The earlier milestone passed 54 tests; use the final run's actual total for the new submission. Do not reuse that count as proof of untested swarm changes.

## Last-mile priority

1. Complete and verify the swarm view; freeze feature scope. Keep the visual map connected to actual controller events.
2. Show the strongest security failures: unapproved recipient, budget refusal, safe retry and uncertain hold. Make these inspectable.
3. Fix clean-clone instructions and record a short video containing both the simulated stress run and the separately verified NEAR receipts.
4. Owner reviews code, video and exact claims at 00:34. Resolve publication, license and submission identity immediately after review if proceeding.
5. Leave a buffer before 00:59 for the owner's public X post and final submission. Do not add bridges, new payment rails or live-wallet permissions now.
