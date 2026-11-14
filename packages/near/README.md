# NEAR evidence boundary

`inspectNearSettlement` checks a trusted NEAR testnet transaction outcome against
an issued order. The caller must obtain the outcome with `wait_until: FINAL` and
independently bind the exact signed delegate action to the stored payload hash.
The caller must also identify the delegate receipt and the receipt that executes
the single token transfer. Receipt outcomes expose executors, status, and child
receipt IDs. They do not establish the transfer arguments or the delegate key.

The validator requires a linked receipt at the expected token contract with a
terminal outcome. An inner failure describes that transaction. Releasing a hold
also requires independent proof that no other attempt succeeded or can still
execute. NEAR's delegate action appends the transfer receipt to its child
receipts and completes with an empty success value. The outer transaction's
status instead points to the delegate receipt. See [nearcore's delegate
action](https://github.com/near/nearcore/blob/crates-0.35.0/runtime/runtime/src/actions.rs#L434).

This package has no live NEAR RPC adapter, signed delegate decoder, signature
verification, or live x402 integration. The tests use synthetic RPC responses
and synthetic verified action context.
