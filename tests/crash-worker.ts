import { Ledger } from '../packages/ledger/index.ts';
import { policy,offer,now } from './fixtures.ts';
const ledger=new Ledger(process.argv[2],policy());const auth=ledger.authorize('researcher',offer(),now);
ledger.issue('researcher',auth.order!.id,()=> 'SIMULATED-survives-process-crash',now);
ledger.submission(auth.order!.id,'SIMULATED-CRASH-TX');
process.send?.({id:auth.order!.id});
setInterval(()=>{},10000);
