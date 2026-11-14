# Dashboard verification — 2026-11-15

Scope: a local visual controller for replaying two existing paid testnet purchases. This is not readiness approval for a general agent platform or production wallet.

- `npm run check`: TypeScript and all 54 tests passed. `npm run demo`: offline simulated fixture passed. An independent reviewer reran both.
- Independent financial review checked child lifecycle isolation, replay guards and proof preservation. Reported issues were fixed before closeout. Final independent source review found no remaining dashboard blockers.
- Browser replay returned both saved reports, showed 21 observed events, and completed with zero new issuances and zero recipient balance change. The UI order is Poppy → x402 → Policy → NEAR → Result.
- Selecting Reviewer changed the report and transaction link. Expanding the result showed the stored transfer receipt. The shared budget showed 2 of 2 micro-wNEAR spent, zero held, and an additional purchase refused.
- Browser QA with an empty temporary root showed missing data and a disabled run button. A separate QA server with a simulated failed child showed failure and retained the recorded results. These QA cases performed no signing or network payment calls.
- Both tracked evidence files were byte-for-byte unchanged across replay (SHA-256 checked). Existing user-generated evidence edits were excluded from this change.

The app binds loopback port 8787. A same-origin request with a random page token is required to launch the fixed replay command; concurrent launches are rejected. The replay driver refuses incomplete purchases and disables signing, account provisioning and settlement. Keys and payment payloads are omitted from the browser projection. This is a trusted local process, not an OS sandbox; anyone with equivalent filesystem access can alter the program or ledger.

Remaining product work is listed in `docs/roadmap.md`. All repository content remains private; merging does not authorize publication or deployment.
