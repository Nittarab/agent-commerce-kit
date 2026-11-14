import { fingerprint } from '../core/index.ts';
import type { Order } from '../core/index.ts';

export type AuthorizedOrder = Pick<Order, 'id' | 'fingerprint' | 'paymentState' | 'offer'>;
export interface OrderSigner {
  sign(order: AuthorizedOrder): string;
}

/** The control service must establish the durable issuance gate before calling. */
export class FixtureSigner implements OrderSigner {
  sign(order: AuthorizedOrder): string {
    if (order.paymentState !== 'reserved' && order.paymentState !== 'issued') {
      throw new Error('Fixture signer requires an authorized order');
    }
    if (order.offer.network !== 'near:testnet') throw new Error('Fixture signer requires NEAR testnet terms');
    return 'SIMULATED:' + fingerprint({
      orderId: order.id, fingerprint: order.fingerprint, offer: order.offer,
    });
  }
}
