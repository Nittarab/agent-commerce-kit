import { atomic } from '../core/index.ts';
import type { Offer } from '../core/index.ts';

type JsonObject = Record<string, unknown>;
type Requirement = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: JsonObject;
};
type Challenge = { x402Version: 2; resource: { url: string }; accepts: Requirement[] };

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Expected a JSON object');
  }
  return value as JsonObject;
}

function onlyFields(value: JsonObject, fields: string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error('Unsupported x402 field');
}

function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error('Invalid x402 string');
  return value;
}

function readChallenge(value: unknown): Challenge {
  const challenge = object(value);
  onlyFields(challenge, ['x402Version', 'error', 'resource', 'accepts', 'extensions']);
  if (challenge.x402Version !== 2 || (challenge.error !== undefined && typeof challenge.error !== 'string') ||
      !Array.isArray(challenge.accepts) || challenge.accepts.length === 0 || challenge.accepts.length > 32 ||
      (challenge.extensions !== undefined && Object.keys(object(challenge.extensions)).length > 0)) {
    throw new Error('Unsupported x402 challenge');
  }

  const resource = object(challenge.resource);
  onlyFields(resource, ['url', 'description', 'mimeType', 'serviceName', 'tags', 'iconUrl']);
  const url = nonempty(resource.url);
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || url.includes('#') ||
      address.href !== url) throw new Error('Invalid x402 resource URL');

  return {
    x402Version: 2,
    resource: { url },
    accepts: challenge.accepts.map(input => {
      const requirement = object(input);
      onlyFields(requirement, ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra']);
      const scheme = nonempty(requirement.scheme);
      const network = nonempty(requirement.network);
      if (!/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(network)) throw new Error('Invalid CAIP-2 network');
      const amount = nonempty(requirement.amount);
      atomic(amount);
      const asset = nonempty(requirement.asset);
      const payTo = nonempty(requirement.payTo);
      const timeout = requirement.maxTimeoutSeconds;
      if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout <= 0) {
        throw new Error('Invalid maximum payment timeout');
      }
      const extra = requirement.extra === undefined ? undefined : object(requirement.extra);
      return { scheme, network, amount, asset, payTo, maxTimeoutSeconds: timeout, ...(extra && { extra }) };
    }),
  };
}

export function decodePaymentRequired(status: number, header: unknown): Challenge {
  if (status !== 402 || typeof header !== 'string' || !header || header.length > 16_384) {
    throw new Error('Expected HTTP 402 with one PAYMENT-REQUIRED header');
  }
  const bytes = Buffer.from(header, 'base64');
  if (bytes.toString('base64') !== header) throw new Error('Invalid base64 PAYMENT-REQUIRED header');
  return readChallenge(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

export function selectExactRequirement(input: unknown, offer: Offer, maxTimeoutSeconds: number): Requirement {
  const challenge = readChallenge(input);
  atomic(offer.amountAtomic);
  if (offer.network !== 'near:testnet' || challenge.resource.url !== offer.url ||
      new URL(offer.url).origin !== offer.origin) {
    throw new Error('Resource URL or network does not match the offer');
  }
  const matches = challenge.accepts.filter(requirement =>
    requirement.scheme === 'exact' && requirement.network === offer.network &&
    requirement.amount === offer.amountAtomic && requirement.asset === offer.asset &&
    requirement.payTo === offer.payTo && requirement.maxTimeoutSeconds === maxTimeoutSeconds &&
    (requirement.extra === undefined || Object.keys(requirement.extra).length === 0));
  if (matches.length !== 1) throw new Error('Expected one exact NEAR testnet requirement matching the offer');
  return matches[0];
}
