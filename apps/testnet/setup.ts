import { Account, JsonRpcProvider, KeyPair, nearToYocto } from 'near-api-js';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const dir = '.local/testnet';
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const lock=dir+'/running.lock';
writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
try {
const path = dir + '/accounts.json';
const provider = new JsonRpcProvider({url:'https://rpc.testnet.near.org'});
if (await provider.getNetworkId() !== 'testnet') throw new Error('Testnet required');
if (!existsSync(path)) {
 const root = 'ack-' + randomBytes(6).toString('hex') + '.testnet';
 const account = (accountId:string) => ({accountId, privateKey:KeyPair.fromRandom('ed25519').toString()});
 writeFileSync(path, JSON.stringify({network:'testnet',relayer:account(root),payer:account('buyer.'+root),merchant:account('seller.'+root)},null,2),{mode:0o600,flag:'wx'});
}
const config = JSON.parse(readFileSync(path,'utf8'));
if(config.network!=='testnet')throw new Error('Testnet config required');
async function exists(accountId:string) {
 try {await provider.viewAccount({accountId,blockQuery:{finality:'final'}});return true;}
 catch(e) {if(String(e).includes('does not exist')||String(e).includes('UNKNOWN_ACCOUNT'))return false;throw e;}
}
const relayer = new Account(config.relayer.accountId,provider,config.relayer.privateKey);
if(!await exists(config.relayer.accountId)) {
 const result = await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({newAccountId:config.relayer.accountId,newAccountPublicKey:KeyPair.fromString(config.relayer.privateKey).getPublicKey().toString()}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!result.ok) throw new Error('Testnet faucet returned HTTP '+result.status);
 await result.text();
 console.log('Fresh testnet relayer requested from faucet.');
}
for(const role of ['payer','merchant'] as const) {
 const entry=config[role];
 if(!await exists(entry.accountId)) {
  await relayer.createAccount({newAccountId:entry.accountId,publicKey:KeyPair.fromString(entry.privateKey).getPublicKey(),nearToTransfer:nearToYocto('0.1')});
  console.log('Created dedicated testnet '+role+'.');
 }
 const registered=await provider.callFunction({contractId:'wrap.testnet',method:'storage_balance_of',args:{account_id:entry.accountId},blockQuery:{finality:'final'}});
 if(!registered) await relayer.callFunction({contractId:'wrap.testnet',methodName:'storage_deposit',args:{account_id:entry.accountId,registration_only:true},deposit:nearToYocto('0.00125'),waitUntil:'FINAL'});
}
const payer = new Account(config.payer.accountId,provider,config.payer.privateKey);
const balance=await provider.callFunction<string>({contractId:'wrap.testnet',method:'ft_balance_of',args:{account_id:config.payer.accountId},blockQuery:{finality:'final'}});
if(BigInt(balance??'0')<nearToYocto('0.0001'))await payer.callFunction({contractId:'wrap.testnet',methodName:'near_deposit',args:{},deposit:nearToYocto('0.001'),waitUntil:'FINAL'});
console.log('Testnet accounts and wrapped test tokens ready. Keys remain in ignored local storage.');

} finally {rmSync(lock,{force:true});}
