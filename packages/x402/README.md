# x402 boundary codec

`decodePaymentRequired` accepts an HTTP 402 status and a single standard base64
`PAYMENT-REQUIRED` value containing x402 v2 JSON. `selectExactRequirement` requires
one `exact` requirement for `near:testnet` that matches the core offer's resource
URL, amount, asset, and recipient. Pass the approved timeout separately from
trusted configuration. The selected requirement supports empty or absent
`extra`. The challenge supports empty or absent `extensions`.

The request method, body, payer, and offer validity come from the caller's
control layer. A challenge containing a payer assertion is refused. Matching
the challenge URL to the offer checks local consistency. Payment proof and
settlement verification need independent evidence. This codec has no transport,
facilitator, or settlement implementation.
