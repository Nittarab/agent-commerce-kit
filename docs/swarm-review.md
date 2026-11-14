# Peer swarm review — 15 November 2026

The visual lab is a bounded scripted demonstration of agent-to-agent service purchases. Twelve buyer principals and three fixture seller roles form a peer network. Events are emitted by the actual policy/SQLite coordinator; the view does not create transaction outcomes. Wallet signing and settlement in this swarm use simulated adapters, not live NEAR or general Poppy conversations. Service results are synthetic. The separate testnet panel exposes existing purchases and a guarded real-protocol replay.

## Verification

- TypeScript and 61 tests pass, including shared/principal budget limits at each swarm step, exact retry issuance counts, pause invariance, uncertain-hold persistence, API authorization, and startup refusal around incomplete records.
- Offline `npm run demo` and `npm run demo:swarm` pass. No real signing, facilitator calls or wallet funding occur in these tests.
- Independent financial review exercised every scenario and verified no release of uncertain spend. A new run creates a new isolated ledger; it preserves earlier databases. A scoped tracked-tree/history scan found no common secret/key patterns or reference-product branding; this is not an exhaustive provenance certification.
- Marketplace: 48 requests, 30 delivered, 18 refused, 7 exact retries, 179/180 units committed.
- Tight budget: 48 requests, 12 delivered, 36 refused, 4 exact retries, 60/60 committed.
- Uncertain: 4 delivered, one pending payment, 25 unissued reservations; 18 paid plus161 held. Shared signer remains blocked.

## Local execution

`npm start` launches the local UI with no funding or blockchain actions. `npm run demo:testnet` is opt-in: a fresh environment provisions dedicated testnet wallets and executes the bounded two-purchase integration before opening the local server. An already-completed job uses replay-only mode. Existing locks, incomplete ledgers, or supplier/relay records without the original payer ledger fail closed. No browser receives keys or signing payloads.

Browser QA and demo recording are performed against the local review build. This review does not approve publication, public licensing, mainnet use, full protocol conformance or a live autonomous swarm. The owner retains the release decision.
