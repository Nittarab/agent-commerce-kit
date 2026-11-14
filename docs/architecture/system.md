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
