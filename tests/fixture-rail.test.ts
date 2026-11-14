import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureRail } from '../packages/wallet/fixture-rail.ts';
import { Ledger } from '../packages/ledger/index.ts';
import { FixtureSigner } from '../packages/wallet/index.ts';
import { policy,offer,now } from './fixtures.ts';
test('fixture unknown outcome survives restart and cannot become success from new fault configuration',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rail-fixture-'));const ledger=new Ledger(join(dir,'ledger'),policy());
 let rail=new FixtureRail(join(dir,'rail'));
 try {
  const reserved=ledger.authorize('researcher',offer(),now).order!;
  const issued=ledger.issue('researcher',reserved.id,o=>new FixtureSigner().sign(o),now);
  const tx=rail.prepare(issued.order,issued.payload,'unknown');const pending=ledger.submission(reserved.id,tx);
  rail.close();rail=new FixtureRail(join(dir,'rail'));
  assert.equal(rail.prepare(issued.order,issued.payload,'success'),tx);
  assert.equal(rail.inspect(pending)?.outcome,'unknown');
  ledger.reconcile(rail.inspect(pending)!);assert.equal(ledger.budget('researcher').jobCommittedAtomic,'60');
  assert.throws(()=>rail.prepare({...issued.order,id:'another-order'},issued.payload,'success'),/Conflicting|different order/);
 } finally {rail.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
