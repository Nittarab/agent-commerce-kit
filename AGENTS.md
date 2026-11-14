# Private agent commerce kit

- This repository belongs to Nittarab and MUST remain private. Only the user can authorize making it public after their review. No npm publication, public demo deployment, releases, or open-source license assignment without that instruction.
- Write an original implementation from public standards and documented behavior. Do not copy proprietary source, investor materials, private customer data, other product branding or APIs.
- Work on codex/ branches. Do not merge into main without user approval. Subagents use separate worktrees; never share mutable source directories.
- Do not call the reference financial-control service. No real signing, payments, wallet funding, or live facilitator calls in fixture tests.
- Node 24 LTS, TypeScript with erasable syntax, node:test, SQLite. Run npm run check and npm run demo. Runtime fixtures must be labelled simulated. Never claim x402 settlement or complete Poppy conformance from fixture success.
- Keep keys and actor authentication outside model context. Deny by default. Atomically reserve shared budgets before signature issuance. Retain uncertain spend. Never implement release based only on timeout, nonce advance or expiry.
- Before changing contracts, read docs/specs/private-foundation.md and packages/core/index.ts. Record limitations in README and architecture.
- No autonomous third-party subagent delegation. Use configured model for coding; small tasks direct. Independent review required before reporting readiness.
