import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { fingerprint,sha256 } from '../core/index.ts';
import type { Order, SettlementEvidence } from '../core/index.ts';
export type FixtureOutcome = 'success'|'failure'|'unknown';
/** Durable SIMULATION only. Real settlement must supply an authoritative adapter. */
export class FixtureRail {
 #db:DatabaseSync;
 constructor(path:string){this.#db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);this.#db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS fixture_attempts(payload_hash TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL, transaction_id TEXT UNIQUE NOT NULL, terms_hash TEXT NOT NULL, outcome TEXT NOT NULL);');}
 close(){this.#db.close();}
 prepare(order:Order,payload:string,outcome:FixtureOutcome):string {
  if(!payload.startsWith('SIMULATED:')||sha256(payload)!==order.payloadHash||!['success','failure','unknown'].includes(outcome))throw new Error('Invalid fixture payment');
  const tx='SIMULATED-TX-'+sha256(payload).slice(0,32);
  this.#db.prepare('INSERT OR IGNORE INTO fixture_attempts VALUES (?,?,?,?,?)').run(order.payloadHash,order.id,tx,fingerprint(order.offer),outcome);
  const row=this.lookup(order);if(!row||row.transaction_id!==tx)throw new Error('Conflicting fixture attempt');return tx;
 }
 private lookup(order:Order){
  const row=this.#db.prepare('SELECT * FROM fixture_attempts WHERE payload_hash=?').get(order.payloadHash??'') as {order_id:string;transaction_id:string;terms_hash:string;outcome:FixtureOutcome}|undefined;
  if(row&&(row.order_id!==order.id||row.terms_hash!==fingerprint(order.offer)))throw new Error('Fixture payment used for a different order');return row;
 }
 inspect(order:Order):SettlementEvidence|undefined{
  const row=this.lookup(order);if(!row)return undefined;
  return {orderId:order.id,payloadHash:order.payloadHash!,transactionId:row.transaction_id,network:order.offer.network,asset:order.offer.asset,payer:order.offer.payer,payTo:order.offer.payTo,amountAtomic:order.offer.amountAtomic,final:row.outcome!=='unknown',outcome:row.outcome,noFurtherExecution:row.outcome==='failure'};
 }
}
