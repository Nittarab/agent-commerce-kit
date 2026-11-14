import { parseDictionary } from 'structured-headers';
import { decodeOperation } from './index.ts';
import { canonical } from '../core/index.ts';
import type { Offer } from '../core/index.ts';

export function assertApiDiscovery(input:any,origin:string){
 if(input?.protocol_version!=='1.0'||input?.organization?.domain!==new URL(origin).host||input.auth?.issuer||input.apis?.length!==1||input.apis[0].type!=='openapi'||input.apis[0].url!==origin+'/openapi.json'||input.extensions?.operations?.[0]?.version!=='3'||input.extensions.operations[0].endpoint!==undefined)throw new Error('Unsupported pinned Poppy API discovery');
}
export function operationFor(offer:Offer){return {operation_id:offer.operationId,revision:offer.revision,summary:'Buy a finalized NEAR testnet block report',terms:{method:offer.method,url:offer.url,body_hash:offer.bodyHash,payer:offer.payer,asset:offer.asset,recipient:offer.payTo,amount_atomic:offer.amountAtomic,network:offer.network},expires_at:offer.expiresAt};}
export function assertOperation(input:unknown,offer:Offer){
 const op=decodeOperation(input),expected=decodeOperation(operationFor(offer));
 if(canonical(op)!==canonical(expected))throw new Error('Poppy operation terms mismatch');
 return op;
}
export function assertApproval(header:unknown,offer:Offer,now:number,allowExpired=false){
 if(typeof header!=='string'||header.length>4096)throw new Error('Poppy approval required');
 const dictionary=parseDictionary(header);
 const value=(name:string)=>dictionary.get(name)?.[0];
 if(value('operation_id')!==offer.operationId||value('revision')!==offer.revision||value('approver')!=='agent'||typeof value('approved_at')!=='number'||!Number.isSafeInteger(value('approved_at'))||Number(value('approved_at'))<0||Number(value('approved_at'))>now||Number(value('approved_at'))*1000>=Date.parse(offer.expiresAt)||typeof value('reference')!=='string'||(!allowExpired&&now*1000>=Date.parse(offer.expiresAt)))throw new Error('Invalid or expired Poppy approval');
}
