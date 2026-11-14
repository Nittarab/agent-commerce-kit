import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import type { Offer } from '../packages/core/index.ts';
import {
  classifyApprovalResponse, createApprovalHeader, decodeOperation, operationFingerprint,
  createSessionSigner, validateDiscovery, verifySession,
} from '../packages/poppy/index.ts';
import { decodePaymentRequired, selectExactRequirement } from '../packages/x402/index.ts';

const now = 1_800_000_000;
const audience = 'https://supplier.example';
const request = { method: 'POST', url: audience + '/research?format=text' };
const context = {
  iss: 'https://agent.example/client.json',
  aud: audience,
  sid: 'sim_session',
  sub: 'sim_researcher',
  request,
  approvedRequests: [request],
  now,
};

test('Poppy accepts only the pinned well-known discovery and conversation metadata', () => {
  const source = audience + '/.well-known/poppy.json';
  const configuration = { companyOrigin: audience, conversationEndpoint: request.url, noOAuthIssuer: true as const };
  const document = {
    protocol_version: '1.0',
    organization: { name: 'Simulated supplier', domain: 'supplier.example' },
    agent: { protocols: [{ type: 'poppy', endpoint: request.url, description: 'Research', access: 'session' }] },
  };
  assert.equal(validateDiscovery(document, source, configuration).audience, audience);
  assert.throws(() => validateDiscovery(document, 'http://supplier.example/.well-known/poppy.json', configuration));
  assert.throws(() => validateDiscovery(document, source + '?copy=1', configuration));
  assert.throws(() => validateDiscovery({ ...document, protocol_version: '2.0' }, source, configuration));
  assert.throws(() => validateDiscovery({ ...document, auth: { issuer: audience } }, source, configuration));
  const mutations = [
    { endpoint: 'https://other.example/research' },
    { endpoint: audience + '/unlisted' },
    { access: 'signed_in' },
  ];
  for (const mutation of mutations) {
    const changed = { ...document, agent: { protocols: [{ ...document.agent.protocols[0], ...mutation }] } };
    assert.throws(() => validateDiscovery(changed, source, configuration));
  }
});

test('Poppy verifies fresh per-request ES256 sessions using pinned issuer and delegated keys', () => {
  const issuer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const delegated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const stranger = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const kid = 'sim_issuer';
  const issuerKey = { ...issuer.publicKey.export({ format: 'jwk' }), kid };
  const issuerKeys = [issuerKey];

  const identity = { iss: context.iss, aud: context.aud, sub: context.sub };
  const issuerCredential = { kid, privateKey: issuer.privateKey };
  const signer = createSessionSigner(identity, issuerCredential, now, now + 120);
  const token = signer.signSession(context);
  const claims = verifySession(token, context, issuerKeys);
  assert.equal(claims.htu, audience + '/research');
  assert.equal(claims.htm, 'POST');
  assert.notEqual(verifySession(
    signer.signSession(context), context, issuerKeys,
  ).jti, claims.jti);

  for (const mutation of [
    { aud: 'https://different.example' }, { iss: 'https://different.example/client.json' },
    { sub: 'sim_reviewer' }, { sid: 'sim_other_session' }, { now: now - 1 }, { now: now + 61 },
    { now: now + 120 }, { approvedRequests: [] },
    { request: { ...request, method: 'GET' }, approvedRequests: [{ ...request, method: 'GET' }] },
    { request: { ...request, url: audience + '/other' }, approvedRequests: [{ ...request, url: audience + '/other' }] },
  ]) {
    assert.throws(() => verifySession(token, { ...context, ...mutation }, issuerKeys));
  }
  assert.throws(() => verifySession(token, context, []));
  assert.throws(() => verifySession(token, context, [issuerKey, issuerKey]));
  assert.throws(() => verifySession(token, context, [{ ...stranger.publicKey.export({ format: 'jwk' }), kid }]));
  assert.throws(() => signer.signSession({ ...context, sub: 'sim_reviewer' }), /Signer is scoped/);
  assert.throws(() => signer.signSession({ ...context, aud: 'https://other.example' }), /Signer is scoped/);
  assert.throws(() => signer.signSession({ ...context, iss: 'https://other.example/client.json' }), /Signer is scoped/);
  identity.sub = 'sim_reviewer';
  assert.throws(() => signer.signSession({ ...context, sub: identity.sub }), /Signer is scoped/);
  assert.throws(() => signer.signSession({ ...context, now: now + 120 }), /Invalid delegation lifetime/);
  assert.throws(() => createSessionSigner(identity, issuerCredential, now, now + 86_401));

  const [header, payload, signature] = token.split('.');
  const wireClaims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.throws(() => verifySession(header + '.' + payload + '.' + signature + '=', context, issuerKeys));
  assert.throws(() => verifySession(header + '.' + payload + '.' + Buffer.alloc(64).toString('base64url'), context, issuerKeys));
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const { x, y } = delegated.publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'P-256', kty: 'EC', x, y };
  const delegatedKid = createHash('sha256').update(JSON.stringify(jwk)).digest('base64url');
  const issueFixtureJwt = (jwtHeader: unknown, jwtClaims: unknown, key: typeof issuer.privateKey) => {
    const input = encoded(jwtHeader) + '.' + encoded(jwtClaims);
    const proof = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
    return input + '.' + proof.toString('base64url');
  };
  const delegation = issueFixtureJwt({ alg: 'ES256', kid, typ: 'poppy-delegation+jwt' },
    { iss: context.iss, cnf: { jwk }, iat: now, exp: now + 120, jti: 'sim_delegation' }, issuer.privateKey);
  const protectedHeader = { alg: 'ES256', kid: delegatedKid, typ: 'poppy-session+jwt', poppy_dlg: delegation };
  assert.deepEqual(verifySession(issueFixtureJwt(protectedHeader, wireClaims, delegated.privateKey), context, issuerKeys), claims);
  for (const [changedHeader, changedClaims] of [
    [{ ...protectedHeader, alg: 'none' }, wireClaims],
    [{ ...protectedHeader, typ: 'JWT' }, wireClaims],
    [{ ...protectedHeader, poppy_dlg: undefined }, wireClaims],
    [{ ...protectedHeader, kid: 'wrong' }, wireClaims],
    [{ ...protectedHeader, jku: 'https://different.example/jwks' }, wireClaims],
    [protectedHeader, { ...wireClaims, aud: [audience] }],
    [protectedHeader, { ...wireClaims, jti: undefined }],
    [protectedHeader, { ...wireClaims, ath: 'unexpected_token' }],
  ]) {
    const changed = issueFixtureJwt(changedHeader, changedClaims, delegated.privateKey);
    assert.throws(() => verifySession(changed, context, issuerKeys));
  }
});

const offer: Offer = {
  operationId: 'sim_operation', revision: 'r1', jobId: 'sim_job', supplierId: 'sim_supplier',
  origin: audience, method: request.method, url: request.url, bodyHash: 'sim_body_hash',
  network: 'near:testnet', asset: 'sim-token.testnet', payer: 'sim-buyer.testnet', payTo: 'sim-merchant.testnet',
  amountAtomic: '100', expiresAt: new Date((now + 30) * 1000).toISOString(),
};

test('Poppy approvals cover one exact revision and route changes or refusal to the owner', () => {
  const operation = decodeOperation({
    operation_id: offer.operationId, revision: offer.revision, terms: { asset: offer.asset, amount: '100' },
    expires_at: offer.expiresAt,
  });
  const approval = { fingerprint: operationFingerprint(operation, offer), approver: 'agent' as const,
    reference: 'sim_approval', approvedAt: now };
  assert.match(createApprovalHeader(operation, offer, approval, 'initial', now), /revision="r1", approver="agent"/);
  assert.throws(() => createApprovalHeader({ ...operation, terms: { amount: '101' } }, offer, approval, 'initial', now));
  assert.throws(() => createApprovalHeader(operation, { ...offer, bodyHash: 'changed' }, approval, 'initial', now));
  assert.throws(() => createApprovalHeader(operation, offer, approval, 'initial', now + 30));
  const amended = { ...operation, revision: 'r2' };
  const decision = classifyApprovalResponse(403, { error: 'approval_required', operation: amended }, operation);
  assert.deepEqual(decision, { state: 'owner_required', replacement: amended });
  const newOffer = { ...offer, revision: 'r2' };
  const amendedApproval = { ...approval, fingerprint: operationFingerprint(amended, newOffer), reference: 'sim_owner' };
  assert.throws(() => createApprovalHeader(amended, newOffer, approval, 'owner_required', now));
  assert.throws(() => createApprovalHeader(amended, newOffer, amendedApproval, 'owner_required', now));
  assert.match(createApprovalHeader(amended, newOffer, { ...amendedApproval, approver: 'user' }, 'owner_required', now),
    /revision="r2", approver="user"/);
  assert.throws(() => classifyApprovalResponse(403, { error: 'approval_required', operation }, operation));
  const declined = { error: 'approval_declined', operation_id: operation.operation_id, revision: operation.revision };
  assert.deepEqual(classifyApprovalResponse(403, declined, operation), { state: 'declined' });
  assert.throws(() => classifyApprovalResponse(403, { ...declined, revision: 'r2' }, operation));
});

test('x402 validates a v2 402 header and selects only the exact pinned NEAR testnet terms', () => {
  const requirement = { scheme: 'exact', network: offer.network, amount: offer.amountAtomic,
    payTo: offer.payTo, asset: offer.asset, maxTimeoutSeconds: 60 };
  const challenge = { x402Version: 2, resource: { url: offer.url }, accepts: [requirement], extensions: {} };
  const base64 = (input: unknown) => Buffer.from(JSON.stringify(input)).toString('base64');
  const header = base64(challenge);
  const decoded = decodePaymentRequired(402, header);
  assert.deepEqual(selectExactRequirement(decoded, offer, 60), requirement);
  assert.throws(() => decodePaymentRequired(200, header));
  assert.throws(() => decodePaymentRequired(402, header + ' '));
  for (const mutation of [
    { amount: '101' }, { amount: '0100' }, { amount: 100 }, { network: 'near:mainnet' },
    { payTo: 'other.testnet' }, { asset: 'other-token.testnet' }, { scheme: 'upto' }, { maxTimeoutSeconds: 61 },
    { payer: offer.payer }, { extra: { payer: offer.payer } }, { extra: { paymentFlow: 'other' } },
  ]) {
    const changed = { ...challenge, accepts: [{ ...requirement, ...mutation }] };
    assert.throws(() => selectExactRequirement(decodePaymentRequired(402, base64(changed)), offer, 60));
  }
  assert.throws(() => decodePaymentRequired(402, base64({ ...challenge, x402Version: 1 })));
  assert.throws(() => selectExactRequirement({ ...challenge, accepts: [requirement, requirement] }, offer, 60));
  assert.throws(() => selectExactRequirement({ ...challenge, resource: { url: audience + '/changed' } }, offer, 60));
  assert.throws(() => selectExactRequirement(challenge, { ...offer, origin: 'https://other.example' }, 60));
});

test('Poppy preserves RFC 3339 expiry text while matching its instant to the core offer', () => {
  const utc = '2026-10-08T19:20:00.000Z';
  const offset = '2026-10-08T12:20:00-07:00';
  const revisedOffer = { ...offer, expiresAt: utc };
  const operation = {
    operation_id: offer.operationId, revision: offer.revision, terms: { amount: '100' }, expires_at: offset,
  };
  assert.equal(decodeOperation(operation).expires_at, offset);
  const fingerprint = operationFingerprint(operation, revisedOffer);
  assert.notEqual(fingerprint, operationFingerprint({ ...operation, expires_at: utc }, revisedOffer));
  const expirySeconds = Date.parse(utc) / 1000;
  const approval = { fingerprint, approver: 'user' as const, reference: 'sim_approval', approvedAt: expirySeconds - 1 };
  assert.match(createApprovalHeader(operation, revisedOffer, approval, 'initial', expirySeconds - 1), /approver="user"/);
  assert.throws(() => createApprovalHeader(operation, revisedOffer, approval, 'initial', expirySeconds));
  assert.throws(() => operationFingerprint({ ...operation, expires_at: '2026-10-08T12:20:00+07:00' }, revisedOffer));
  assert.throws(() => decodeOperation({ ...operation, expires_at: '2026-10-08T12:20:00-07:60' }));
  assert.throws(() => decodeOperation({ ...operation, expires_at: '2026-02-30T12:20:00-07:00' }));
});
