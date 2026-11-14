import type { Order } from '../../packages/core/index.ts';
/** Fail before any replay can reach signing or submission without complete saved purchases. */
export function assertReplayOrders(orders:(Order|undefined)[]):asserts orders is Order[]{
 if(orders.length!==2||orders.some(o=>!o||o.paymentState!=='settled'||o.deliveryState!=='delivered'||!o.payloadHash||!o.transactionId||!o.result))throw new Error('Replay-only requires both settled and delivered purchases');
}
