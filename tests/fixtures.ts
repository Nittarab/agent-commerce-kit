import { readFileSync } from 'node:fs';
import { sha256 } from '../packages/core/index.ts';
import type { Policy, Offer, SettlementEvidence, Order } from '../packages/core/index.ts';
export const now = new Date('2026-11-14T22:00:00Z');
export function policy(): Policy { return JSON.parse(readFileSync(new URL('../policies/demo.json',import.meta.url),'utf8')); }
export function offer(overrides: Partial<Offer> = {}): Offer { return {operationId:'operation-1',revision:'1',jobId:'demo-job',supplierId:'fixture-supplier',origin:'https://supplier.example',url:'https://supplier.example/data',method:'POST',bodyHash:sha256('{}'),network:'near:testnet',asset:'demo-token.testnet',payer:'buyer.testnet',payTo:'supplier.testnet',amountAtomic:'60',expiresAt:'2029-01-01T00:00:00Z',...overrides}; }
export function success(order: Order): SettlementEvidence { return {orderId:order.id,payloadHash:order.payloadHash!,transactionId:order.transactionId!,final:true,outcome:'success',network:order.offer.network,asset:order.offer.asset,payer:order.offer.payer,payTo:order.offer.payTo,amountAtomic:order.offer.amountAtomic,noFurtherExecution:false}; }
