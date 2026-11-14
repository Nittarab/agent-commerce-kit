# Original reconstruction of documented behavior

This is a behavioral reconstruction from available skills/examples and public protocols. No full reference SDK or proprietary engine source was available. Hidden implementation details, compatibility with that engine, and unsupported policy semantics cannot be inferred. This repository does not call that service or reproduce its branding, source or policy language.

| Observed design principle | Our original implementation | Proof / limit |
|---|---|---|
| Refuse before money moves | policy evaluator plus reservation before fixture signing | Negative policy and HTTP escalation tests; live signer not present |
| Independent control boundary | token-authenticated local controller in another process | Client cannot choose principal or owner role; no OS sandbox claim |
| One cumulative budget across agents | SQL transaction over holds and spend | Separate-process 70 + 40 race against 100 |
| Stable intent identity on retries | company/job-scoped operation and immutable revision hash | Duplicate/mutated/revised offer tests |
| Record a decision and durable financial state | order transitions plus hash-linked events | Audit-chain checks; not an administrator-proof ledger |
| Uncertain payment stays accountable | held pending state plus persisted fixture attempt | Lost-response, SIGKILL and unknown-outcome tests |
| Authorization differs from settlement | separate policy, payment and delivery states | Preflight/outer-only NEAR results remain unknown |
| Agent identity is assigned by its operator | authenticated token-to-principal mapping | Cross-principal access denied |
| Money uses exact units | canonical decimal strings parsed as BigInt with u128 bound | Values above Number's safe integer limit tested |
| Policy version is part of the decision | immutable policy pin per ledger | Mismatched policy on reopen rejected |
| Post-payment obligations and deadlines | Not implemented | Requires additional owner-defined semantics and tests |
| Live policy updates and preserved totals | Not implemented | Refuses silent changes rather than resetting counters |
| Double-entry accounting and currencies | Not implemented | This prototype tracks one asset/job budget, not a general financial subledger |
| General policy language | Not implemented | Strict typed JSON and plain-English renderer instead |
| Multi-rail live execution | NEAR testnet only | Live signed transfers are verified; other chains remain unimplemented |

The protocol sources define independent responsibilities. Poppy operations authorize exact business terms. x402 requirements describe payment. NEAR receipts prove a specific transfer only after independent authenticity and correlation checks. Combining these records must not confuse approval, money movement, delivery or output quality.
