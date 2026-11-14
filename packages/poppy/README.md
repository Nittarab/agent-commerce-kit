# Poppy boundary codec

This module implements a local subset of Poppy 1.0 for signed-out sessions.

- `validateDiscovery` takes a document from the final well-known HTTPS URL and checks the domain, version, and caller-pinned signed-out conversation endpoint. The caller must establish the absence of an OAuth issuer.
- `signDelegation`, `signSession`, and `verifySession` use ES256 and P-256 public keys. Pass issuer keys already pinned to the expected client ID. Pass the exact request URL and method and configure their allowlist in trusted code. The JWT binds the method and URL without query or fragment. The caller owns key storage, the one-user-per-delegated-key rule, session continuity, and any replay tracking.
- `decodeOperation` and `operationFingerprint` bind the operation ID, revision, terms, expiry, and complete core offer. This profile uses the core UTC timestamp format. User approval must come from the caller's authenticated owner interface. Agent approval must come from the caller's trusted policy.
- `classifyApprovalResponse` identifies a replacement revision or a matching decline after an approval was submitted. A decline stops retries of that approval. A replacement requires a fresh owner decision. The caller must resolve uncertain execution before seeking approval for any replacement.
- `createApprovalHeader` encodes the caller's trusted approval for an exact operation fingerprint. For a replacement revision after a change or refusal, the caller supplies `owner_required` from its trusted state. It must supply a fresh owner decision and must use the original offer's request when sending the header. The ledger owns idempotency and execution state.

The module has no network transport, OAuth, PS384, browser join, or conversation state. Test keys are ephemeral.
