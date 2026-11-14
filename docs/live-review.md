# Live testnet review and verification

Date: 2026-11-14. Scope: the dedicated, single-host, private testnet integration in docs/specs/live-testnet.md.

Two independent reviewers checked the protocol and financial-control paths. A separate verifier ran the offline checks and queried NEAR RPC without signing or sending a transaction. No review blocker remained for the recorded scope.

## Evidence

- Type checking and all 47 offline tests pass. The original fixture demo still passes and labels its payments simulated.
- Two actual transactions reached FINAL. The verifier independently checked the distinct relayer, payer, wrap.testnet target, one ft_transfer action, exact recipient and 1000000000000000000 atomic units per purchase, 1 yoctoNEAR attached deposit, gas limit, and linked successful inner receipts.
- The supplier returned the protected reports with x402 PAYMENT-RESPONSE headers. Exact retries returned identical bodies and receipts.
- A complete runner restart returned the same transaction IDs with zero new issuances and zero recipient balance change. The earlier nonzero balance observation remains in the evidence history. Balance observations are runner measurements; the verifier independently checked transaction/receipt facts rather than rerunning payments.
- The shared job budget refused an extra purchase. After expiry, the runner records the actual expiry refusal instead of mislabelling it as a budget refusal.
- The repository is private. Key permissions and ignored storage were checked without displaying key values. No mainnet funds or public server deployment were used.
- Browser QA verified the guide's six-step navigation, budget controls, refusal result, live evidence and visible recovery limits. The page also embeds evidence for standalone viewing without fetching a JSON file.

See [machine-readable evidence](testnet-evidence.json).

## Review findings resolved

- Preserve one signed outer transaction and hash before broadcast; reject wrong-hash RPC results before caching.
- Use a read-only exact issued-order lookup for supplier payment verification. Verification cannot reserve funds.
- Serialize facilitator work and use the same exclusive host lock for provisioning and live runs.
- Bind delivery identity to issuer, user and operation ID, independent of revision. Changed terms or payments cannot replace it.
- Persist exact payment bindings for replay after expiry. Concurrent requests share settlement work and return the stored body and receipt.
- Advertise API-only Operations v3 without an unsupported browser endpoint; validate empty GET bodies and return protocol version/session/extension errors.
- Retain balance evidence across restarts; do not infer settlement from how many new signatures a run created.

## Explicit limits

An issued payment that expires before the supplier first binds it cannot automatically resume through the current client flow. Its funds stay held. Final failures also stay held because an authoritative no-further-execution proof and operator resolution path are not implemented.

Poppy support is the pinned signed-out ES256 API/Operations subset. The merchant and facilitator are our own local implementation. The live harness runs trusted components in one process with no model, OS sandbox or third-party conformance claim. Production custody, OAuth, conversations, broader tokens/curves, mainnet and multichain remain outside scope.

Nittarab must review the private changes. No merge, public release, public deployment or open-source license is authorized.
