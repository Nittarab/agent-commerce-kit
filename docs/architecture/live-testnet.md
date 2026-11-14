# Live testnet path

The live runner is a trusted integration harness, not a model sandbox. It runs buyer clients, the HTTPS supplier and embedded facilitator in one Node process. Separate SQLite files hold payer authority, supplier payment bindings/deliveries, and facilitator attempts. The fixture control process remains a separate offline example.

## Protocol and authority flow

1. Fetch pinned Poppy discovery, OpenAPI, client metadata and JWKS over local HTTPS. A dedicated local certificate is trusted only by this client; redirects are refused. The supplier binds to loopback. Discovery advertises an API-only Operations v3 profile, without a browser Operations endpoint.
2. Each principal signs fresh ES256 Session JWTs with a delegated key scoped to its company/user. The server checks signature, delegation, request method/URL, issuer, audience and user. It records JWT IDs to reject replay. GET bodies are refused; exact target URLs include the operation query. The approval separately binds exact operation terms, including method, full URL and empty body hash.
3. The API returns an operation with HTTP 403. The buyer checks all terms and creates an agent approval. The approved request returns an x402 v2 PAYMENT-REQUIRED challenge. The policy/ledger approves and reserves the exact offer before the synchronous signing closure is invoked.
4. The payer creates a single-action ed25519 NEP-366 signed delegate for wrap.testnet ft_transfer, with exact recipient/amount, 1 yoctoNEAR deposit, 30 TGas and a 120-block maximum lifetime. The complete x402 payload is committed to the payer ledger before HTTP exposure.
5. The supplier checks its authenticated operation, exact approval and payment binding. Verification uses a read-only lookup of the already-issued payer order. It cannot create a reservation. The signed payment is bound to issuer, user and operation ID; changing the revision does not create a new delivery identity.
6. The embedded facilitator checks exact Borsh round-trip, signing domain, signature, full-access key, nonce, timeout, token balance and NEP-145 registration. It pins a distinct relayer. One host process lock plus its serial queue prevents nonce allocation races. It saves the exact signed outer transaction, hash and delegate hash before sending anything to RPC.
7. After uncertainty, it polls by the persisted transaction hash and relayer or resends identical bytes. It never signs a new outer transaction for that delegate. It correlates FINAL outer/delegate/inner receipt IDs and checks the token executor and successful transfer outcome. Only then does the payer ledger settle and the supplier store the report and PAYMENT-RESPONSE.
8. Concurrent or restarted exact retrieval returns the stored body and payment response. Changed payloads, terms, principals or revisions cannot reuse the record. An extra purchase is refused by the shared budget; after policy expiry it is refused by expiry instead.

## Durable state and limits

Fresh accounts and keys are stored under ignored `.local/testnet/`. Only public IDs and proof summaries enter documentation. Setup uses the same lock as the runner because it uses the same keys. No other process may use these dedicated account keys. A stale lock is left after a hard process kill; inspect its PID before manual removal.

Supplier bindings commit before settlement. The real initial integration retained an early delivery record when its operation key changed; the exact stored body and receipt were preserved during local development migration. That early unreleased schema is not a supported external migration contract.

The recorded testnet receipt topology matches the existing outcome inspector. Receipt lookup trusts the pinned RPC; there is no independent light-client proof. Success is based on the final inner transfer, not only the outer transaction. Failed or unknown transfers remain held; no automated release based on expiry, nonce or time exists.

Recovery after issuance but before the first supplier binding is limited if the operation expires before the request arrives. It remains held for manual analysis. Bound pending attempts and stored deliveries replay after expiry using their persisted approval. No production recovery/administration UI exists.

The live script measures recipient balances before/after a run. If an attempt was unresolved at startup, it reports the balance window as ambiguous and uses exact final receipts rather than deriving execution from new issuance count. All verification observations are retained, including the earlier nonzero balance observation and later zero-delta replays.

OAuth, general conversations, third-party Poppy conformance, remote merchants, live models/Eve, external wallet services, mainnet, multichain and production custody are not part of this proof.
