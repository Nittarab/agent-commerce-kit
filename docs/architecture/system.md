# Architecture and authority

Status: architecture of the original local simulation. For the separately verified live path, see [live testnet](live-testnet.md).

The model/tool runtime receives only a ControlClient, not the ledger or signer. Each client uses a host-held actor token. The separate controller maps that token to a principal. A body cannot select another principal or assert owner approval. The owner token is different and is needed for stop or compare-and-swap revision approval.

A JSON policy binds one job, payer, asset and network. Supplier origin and payTo are configured independently of untrusted offer text. Policy decisions are pure. SQLite BEGIN IMMEDIATE makes budget inspection and reservation one transaction across connections and processes. Budgets sum integer atomic holds plus settled spend. The policy is pinned to the database and cannot be silently replaced on restart.

Operation identity is job + supplier + operation ID. Revisions have immutable fingerprints. The current head belongs to one principal. An owner replacement request must target an existing head of that same operation. A new revision requires the owner to name the current order ID and revision. An earlier revision cannot be revived; an unresolved or paid attempt prevents another payment for that operation. Exact authenticated replay is available after expiry, but a new issuance still checks the current policy and time.

States: reserved -> issued -> pending -> settled or failed. Reserved and deferred orders can be cancelled locally; an explicit cancellation is terminal. Delivery is a separate not_delivered/delivered state. An issued signature and its recovery bytes commit before they leave the ledger. The prototype signer is synchronous and purely simulated. An external signer would need an idempotent recoverable protocol; replacing this callback with a remote signer without that protocol is unsafe.

One unresolved issued/pending payment blocks another issuance on the shared NEAR account. This conservative ordering prevents later nonces from overtaking earlier ones. It does not prevent additional reservations in the library. The controller changes an unissued reservation to deferred when issuance is blocked and returns its state explicitly. This releases that hold without making the revision terminal. An exact retry checks current policy, budget, expiry and stop in a transaction before reserving the same order again. Issued attempts cannot be deferred. Agents can also cancel their own unissued reservation.

The fixture rail has a separate persistent SQLite file. Its mapping binds signed payload hash, order ID, exact terms, deterministic transaction ID and simulated outcome. It commits before submission is recorded. A restart reads the same outcome; it cannot turn a previously unknown outcome into success because a fault map was lost. An issued fixture without a recorded attempt can safely prepare its first simulated attempt. A pending order whose attempt cannot be found stays pending.

A trusted rail adapter alone supplies settlement evidence. Exact transaction/payload/asset/payer/recipient/amount matching is mandatory. Pending is not failure. Final failure frees a hold only when the adapter proves there was no other successful or still executable attempt. Expiry or a consumed nonce alone is insufficient. A paid result is stored once and can be fetched again by its principal without a new payment.

NEAR outcome inspection accepts only the documented subset with an independently verified transfer context. It cannot authenticate that caller-supplied context; it must not be exposed to agents as an input API. Protocol codecs are not a payment authorization service.

Poppy keys are scoped to one company/user pair. Model output cannot grant authority. The supplier fixture and two buyer identities demonstrate local validation only; OAuth and network interoperability remain unimplemented. The internal controller is loopback-only and uses separate actor/owner tokens. Same-OS-user filesystem isolation is not established by the demo.

The audit chain is an inspection aid, not a cryptographic guarantee against a database administrator. Do not expose signed payloads or authentication tokens in agent results. A policy copy returned by the library is detached from the actual pinned policy.
# Local visual controller

`apps/dashboard/server.ts` reads a safe projection of the configured SQLite ledger and exposes a loopback UI. It launches only the fixed testnet driver in replay-only mode, gated by same-origin checks and a random page token. The driver requires existing settled, delivered purchases; its signing and settlement branches refuse replay. Structured child events describe observed steps, while ledger cards describe recorded purchases. A successful replay requires a zero-issuance, zero-balance-delta summary as well as a successful child exit.

This UI cannot start new jobs, edit policy or resolve held payments. It is not an OS isolation boundary, a general wallet interface, or proof of full Poppy interoperability. See `docs/dashboard-review.md` and `docs/roadmap.md`.

## Swarm lab

The loopback dashboard adds a bounded, cooperative scheduler for twelve scripted buyer principals and three fixture services. Each run invokes the same Ledger authorization, issuance, settlement and delivery state machine using FixtureSigner/FixtureRail only. A single coordinator interleaves requests; this is not twelve autonomous LLM processes. It shares the existing local UI token/origin checks. No public service, RPC, production wallet, or live Poppy/x402 exchange is invoked by swarm scenarios.

A run caps attempts at48 and freezes on pause. Unknown fixture evidence retains its issued payment and blocks further issuance; unissued approved reservations remain held. New runs create new isolated databases under .local/swarm and retain earlier records. Process restart does not reload a scenario into the UI or reconcile holds; this is a demonstrator, not an operator recovery tool. Swarm events are in memory; durable authority and audit records stay in SQLite. Animation is derived from observed coordinator events, with historical rows shown without replaying them as new events.

## Host-pinned agent teams

`runAgentTeam` supplies a per-principal service catalog and accepts only a service ID from model tool proposals. The host owns every immutable offer, principal mapping and payment callback. An attempt is cached per principal/service, including failed attempts, and never automatically replaced after cancellation. Shared monetary budget reservation remains the durable controller's responsibility; the runtime's purchase count is an additional bound, not payment authorization. Deadlines apply per member (at most 16 members); handoff outputs are bounded untrusted data. The host must schema-select and redact merchant content before constructing a model-visible receipt summary. Callback failures are sanitized.

The chat adapter is opt-in and keeps its API credential in the host closure. The team example uses the existing fixture controller and scripted decisions by default. `--model` enables a configured provider but does not enable live payments. The generic commerce SDK has independent settlement and persistence callbacks and currently covers only the pinned GET Poppy profile. Integration into the live wallet driver and live-model end-to-end validation remain unfinished.
