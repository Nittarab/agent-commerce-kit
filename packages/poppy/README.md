# Poppy boundary codec

This module implements a local subset of Poppy 1.0 for signed-out sessions.

- `validateDiscovery` takes a document from the final well-known HTTPS URL and checks the domain, version, and caller-pinned signed-out conversation endpoint. The caller must establish the absence of an OAuth issuer.
- `createSessionSigner(identity, issuer, issuedAt, expiresAt)` creates an ES256 delegated key inside the signer and fixes its issuer, company, and user at creation. The signer exposes `signSession(context)`. Pass the exact request URL and method and configure their allowlist in trusted code. The JWT binds the method and URL without query or fragment. Pass issuer public keys already pinned to the expected client ID to `verifySession`. The caller owns issuer key storage, session continuity, and any replay tracking.
- `decodeOperation` and `operationFingerprint` bind the operation ID, revision, terms, expiry, and complete core offer. The codec preserves the exact RFC 3339 expiry text for the fingerprint, including any offset. It compares the expiry instant with the core offer’s UTC timestamp at the core’s millisecond precision. The calendar validator accepts ordinary seconds from 00 to 59. User approval must come from the caller's authenticated owner interface. Agent approval must come from the caller's trusted policy.
- `classifyApprovalResponse` identifies a replacement revision or a matching decline after an approval was submitted. A decline stops retries of that approval. A replacement requires a fresh owner decision. The caller must resolve uncertain execution before seeking approval for any replacement.
- `createApprovalHeader` encodes the caller's trusted approval for an exact operation fingerprint. For a replacement revision after a change or refusal, the caller supplies `owner_required` from its trusted state. It must supply a fresh owner decision and must use the original offer's request when sending the header. The ledger owns idempotency and execution state.

The module has no network transport, OAuth, PS384, browser join, or conversation state. Test keys are ephemeral.
