import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { planStartup } from '../scripts/start.mjs';

test('local startup never provisions and testnet startup refuses partial records',()=>{
 const root=mkdtempSync(join(tmpdir(),'startup-test-')),local=join(root,'.local/testnet');mkdirSync(local,{recursive:true});
 try{
  assert.deepEqual(planStartup(root),[['apps/dashboard/server.ts']]);
  assert.deepEqual(planStartup(root,true),[['apps/testnet/setup.ts'],['apps/testnet/run.ts'],['apps/dashboard/server.ts']]);
  writeFileSync(join(local,'company.db'),'fixture');assert.throws(()=>planStartup(root,true),/records exist/);rmSync(join(local,'company.db'));
  writeFileSync(join(local,'running.lock'),'fixture');assert.throws(()=>planStartup(root,true),/lock exists/);rmSync(join(local,'running.lock'));
  const db=new DatabaseSync(join(local,'payer.db'));db.exec('CREATE TABLE orders(offer TEXT,payment TEXT,delivery TEXT)');
  try{
   assert.throws(()=>planStartup(root,true),/account configuration/);writeFileSync(join(local,'accounts.json'),'NOT READ BY PLANNER');
   assert.throws(()=>planStartup(root,true),/incomplete/);
   const insert=db.prepare('INSERT INTO orders VALUES (?,?,?)');insert.run(JSON.stringify({operationId:'research-report'}),'settled','delivered');insert.run(JSON.stringify({operationId:'review-report'}),'pending','not_delivered');assert.throws(()=>planStartup(root,true),/unresolved/);
   db.exec("UPDATE orders SET payment='settled', delivery='delivered'");assert.deepEqual(planStartup(root,true),[['apps/testnet/run.ts','--replay-only'],['apps/dashboard/server.ts']]);
  }finally{db.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
