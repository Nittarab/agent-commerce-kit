import { Ledger } from '../packages/ledger/index.ts';
import { policy,offer,now } from './fixtures.ts';
const [, ,path,principal,amount]=process.argv;
const ledger=new Ledger(path,policy());
console.log(ledger.authorize(principal,offer({operationId:principal,amountAtomic:amount}),now).kind);
ledger.close();
