import { createHash, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { canonical, fingerprint, timestamp } from '../core/index.ts';
import type { Offer } from '../core/index.ts';

type ObjectValue = Record<string, unknown>;
type PublicKey = JsonWebKey & { kid: string };
type Request = { url: string; method: string };
type Session = { iss: string; aud: string; sid: string; sub: string };
type RequestContext = Session & { request: Request; approvedRequests: readonly Request[]; now: number };
type Operation = { operation_id: string; revision: string; terms: ObjectValue; expires_at: string };

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Expected a JSON object');
  }
  return value as ObjectValue;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    throw new Error('Invalid opaque ID');
  }
  return value;
}

function https(value: unknown): URL {
  if (typeof value !== 'string' || !value.startsWith('https://')) throw new Error('Expected HTTPS URL');
  const url = new URL(value);
  if (url.href !== value || url.username || url.password || value.includes('#')) {
    throw new Error('Expected a canonical HTTPS URL without credentials or fragment');
  }
  return url;
}

export function validateDiscovery(document: unknown, sourceUrl: string, configuration: {
  companyOrigin: string; conversationEndpoint: string; noOAuthIssuer: true;
}) {
  const source = https(sourceUrl);
  const doc = object(document);
  const organization = object(doc.organization);
  const auth = doc.auth === undefined ? {} : object(doc.auth);
  if (configuration.noOAuthIssuer !== true || source.origin !== configuration.companyOrigin ||
      source.href !== source.origin + '/.well-known/poppy.json' ||
      doc.protocol_version !== '1.0' || typeof organization.name !== 'string' || !organization.name.trim() ||
      typeof organization.domain !== 'string' || organization.domain.toLowerCase() !== source.host ||
      auth.issuer !== undefined || auth.scopes !== undefined || auth.scope_hints !== undefined) {
    throw new Error('Discovery is outside the pinned signed-out company profile');
  }
  if (organization.logo_uri !== undefined) https(organization.logo_uri);
  const endpoint = https(configuration.conversationEndpoint).href;
  const protocols = object(doc.agent).protocols;
  if (!Array.isArray(protocols)) throw new Error('Missing conversation protocols');
  const matches = protocols.map(object).filter(entry => entry.type === 'poppy' && entry.endpoint === endpoint);
  if (matches.length !== 1 || typeof matches[0].description !== 'string' || !matches[0].description.trim() ||
      (matches[0].access !== undefined && matches[0].access !== 'session')) {
    throw new Error('Missing unique approved signed-out Poppy conversation endpoint');
  }
  return { version: '1.0' as const, audience: source.origin, conversationEndpoint: endpoint };
}

function decodeSegment(segment: string): Buffer {
  const bytes = Buffer.from(segment, 'base64url');
  if (!segment || bytes.toString('base64url') !== segment) throw new Error('Invalid JWT encoding');
  return bytes;
}

function parseJwt(token: string, typ: string, fields: string[]) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('Invalid JWT size');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid compact JWT');
  const [header, payload, signature] = parts.map(decodeSegment);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const protectedHeader = object(JSON.parse(decoder.decode(header)));
  if (protectedHeader.typ !== typ || protectedHeader.alg !== 'ES256' ||
      Object.keys(protectedHeader).sort().join(',') !== fields.join(',') || signature.length !== 64) {
    throw new Error('Unsupported JWT header or signature encoding');
  }
  return {
    header: protectedHeader,
    claims: object(JSON.parse(decoder.decode(payload))),
    input: Buffer.from(parts.slice(0, 2).join('.')),
    signature,
  };
}

function seconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Expected Unix seconds');
  }
  return value;
}

function p256(key: KeyObject, type: 'private' | 'public'): KeyObject {
  if (key.type !== type || key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Expected a P-256 key');
  }
  return key;
}

function publicJwk(raw: unknown): { crv: 'P-256'; kty: 'EC'; x: string; y: string } {
  const { crv, kty, x, y, d } = object(raw);
  if (d !== undefined || crv !== 'P-256' || kty !== 'EC' ||
      typeof x !== 'string' || typeof y !== 'string' ||
      decodeSegment(x).length !== 32 || decodeSegment(y).length !== 32) {
    throw new Error('Invalid public P-256 JWK');
  }
  return { crv, kty, x, y };
}

function thumbprint(key: JsonWebKey): string {
  return createHash('sha256').update(canonical(publicJwk(key))).digest('base64url');
}

function signJwt(header: ObjectValue, claims: ObjectValue, key: KeyObject): string {
  const input = [header, claims].map(part => Buffer.from(canonical(part)).toString('base64url')).join('.');
  const signature = sign('sha256', Buffer.from(input), { key: p256(key, 'private'), dsaEncoding: 'ieee-p1363' });
  return input + '.' + signature.toString('base64url');
}

function requireSignature(jwt: ReturnType<typeof parseJwt>, jwk: JsonWebKey) {
  const key = p256(createPublicKey({ key: publicJwk(jwk), format: 'jwk' }), 'public');
  if (!verify('sha256', jwt.input, { key, dsaEncoding: 'ieee-p1363' }, jwt.signature)) {
    throw new Error('Invalid JWT signature');
  }
}

function jti(): string {
  return randomBytes(16).toString('base64url');
}

function checkDelegationTime(iat: number, exp: number, now: number) {
  if (iat > now || exp <= now || exp - iat > 86_400) throw new Error('Invalid delegation lifetime');
}

export function signDelegation(issuer: string, signingKid: string, issuerKey: KeyObject,
  delegatedPublicKey: KeyObject, now: number, expires: number): string {
  https(issuer);
  id(signingKid);
  checkDelegationTime(seconds(now), seconds(expires), now);
  const jwk = publicJwk(p256(delegatedPublicKey, 'public').export({ format: 'jwk' }));
  return signJwt({ alg: 'ES256', typ: 'poppy-delegation+jwt', kid: signingKid }, {
    iss: issuer, cnf: { jwk }, iat: now, exp: expires, jti: jti(),
  }, issuerKey);
}

function requestClaims(context: RequestContext) {
  const { request } = context;
  const url = https(request.url);
  if (!/^[A-Z]+$/.test(request.method) ||
      !context.approvedRequests.some(entry => entry.method === request.method && entry.url === request.url)) {
    throw new Error('Request destination or method is not approved');
  }
  https(context.iss);
  if (https(context.aud + '/').origin !== context.aud) throw new Error('Expected signed-out company audience');
  url.search = '';
  return {
    iss: context.iss, aud: context.aud, sid: id(context.sid), sub: id(context.sub),
    htu: url.href, htm: request.method,
  };
}

function verifyDelegation(token: string, issuer: string, keys: readonly PublicKey[], now: number) {
  const delegation = parseJwt(token, 'poppy-delegation+jwt', ['alg', 'kid', 'typ']);
  const kid = id(delegation.header.kid);
  const matches = keys.filter(key => key.kid === kid);
  if (matches.length !== 1) throw new Error('Delegation key is not pinned to the issuer');
  requireSignature(delegation, matches[0]);
  const { iss, cnf, iat, exp, jti: delegationId } = delegation.claims;
  if (iss !== issuer || Object.keys(delegation.claims).sort().join(',') !== 'cnf,exp,iat,iss,jti') {
    throw new Error('Invalid delegation claims');
  }
  id(delegationId);
  const issued = seconds(iat);
  checkDelegationTime(issued, seconds(exp), now);
  return { jwk: publicJwk(object(cnf).jwk), issued };
}

export function signSession(context: RequestContext, delegation: string, delegatedPrivateKey: KeyObject,
  issuerKeys: readonly PublicKey[]): string {
  const claims = requestClaims(context);
  const now = seconds(context.now);
  const { jwk } = verifyDelegation(delegation, claims.iss, issuerKeys, now);
  const signer = createPublicKey(p256(delegatedPrivateKey, 'private')).export({ format: 'jwk' });
  const kid = thumbprint(jwk);
  if (thumbprint(signer) !== kid) throw new Error('Delegation does not name the signing key');
  return signJwt({ alg: 'ES256', typ: 'poppy-session+jwt', kid, poppy_dlg: delegation },
    { ...claims, iat: now, jti: jti() }, delegatedPrivateKey);
}

export function verifySession(token: string, context: RequestContext, issuerKeys: readonly PublicKey[]) {
  const expected = requestClaims(context);
  const now = seconds(context.now);
  const session = parseJwt(token, 'poppy-session+jwt', ['alg', 'kid', 'poppy_dlg', 'typ']);
  if (typeof session.header.poppy_dlg !== 'string') throw new Error('Missing delegation');
  const { jwk, issued } = verifyDelegation(session.header.poppy_dlg, expected.iss, issuerKeys, now);
  if (session.header.kid !== thumbprint(jwk)) throw new Error('Delegated key thumbprint mismatch');
  requireSignature(session, jwk);
  if (Object.keys(session.claims).sort().join(',') !== 'aud,htm,htu,iat,iss,jti,sid,sub' ||
      Object.entries(expected).some(([key, value]) => session.claims[key] !== value)) {
    throw new Error('Session identity or request binding mismatch');
  }
  const iat = seconds(session.claims.iat);
  if (iat < issued || iat > now || now - iat > 60) throw new Error('Session is outside its freshness window');
  return { ...expected, iat, jti: id(session.claims.jti) };
}

export function decodeOperation(input: unknown): Operation {
  const value = object(input);
  const expires = value.expires_at;
  timestamp(expires);
  return {
    operation_id: id(value.operation_id),
    revision: id(value.revision),
    terms: structuredClone(object(value.terms)),
    expires_at: expires as string,
  };
}

export function operationFingerprint(operation: Operation, offer: Offer): string {
  const terms = decodeOperation(operation);
  if (terms.operation_id !== offer.operationId || terms.revision !== offer.revision ||
      terms.expires_at !== offer.expiresAt) throw new Error('Operation and offer revision do not match');
  return fingerprint({ operation: terms, offer });
}

export function createApprovalHeader(operation: Operation, offer: Offer, approval: {
  fingerprint: string; approver: 'user' | 'agent'; reference: string; approvedAt: number;
}, state: 'initial' | 'owner_required', now: number): string {
  const expires = timestamp(operation.expires_at);
  const approvedAt = seconds(approval.approvedAt);
  const current = seconds(now);
  if (current >= expires / 1000 || approvedAt > current ||
      (approval.approver !== 'user' && approval.approver !== 'agent') ||
      (state !== 'initial' && (state !== 'owner_required' || approval.approver !== 'user')) ||
      approval.fingerprint !== operationFingerprint(operation, offer)) {
    throw new Error('Operation needs current approval for its exact terms');
  }
  return [
    'operation_id="' + operation.operation_id + '"',
    'revision="' + operation.revision + '"',
    'approver="' + approval.approver + '"',
    'approved_at=' + approvedAt,
    'reference="' + id(approval.reference) + '"',
  ].join(', ');
}

export function classifyApprovalResponse(status: number, input: unknown, submitted: Operation) {
  const body = object(input);
  const previous = decodeOperation(submitted);
  if (status === 403 && body.error === 'approval_declined' &&
      body.operation_id === previous.operation_id && body.revision === previous.revision) {
    return { state: 'declined' as const };
  }
  if (status === 403 && body.error === 'approval_required') {
    const replacement = decodeOperation(body.operation);
    if (replacement.operation_id === previous.operation_id && replacement.revision !== previous.revision) {
      return { state: 'owner_required' as const, replacement };
    }
  }
  throw new Error('Unrecognized response to operation approval');
}
