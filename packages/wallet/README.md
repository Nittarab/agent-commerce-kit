# Fixture wallet

`FixtureSigner` returns a deterministic opaque string prefixed with `SIMULATED:`.
The control service must establish the durable authorization and issuance gate
before it invokes the signer. The fixture has no key material and produces no
NEAR signature or usable x402 payment payload.
