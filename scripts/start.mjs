import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Read-only planning: no network, keys, setup, or signing is reachable here. */
export function planStartup(directory, testnet = false) {
  const dashboard = ['apps/dashboard/server.ts'];
  if (!testnet) return [dashboard];
  const local = join(directory, '.local/testnet');
  if (existsSync(join(local, 'running.lock'))) {
    throw new Error('A testnet runner lock exists. Inspect its recorded process before retrying; this command will not remove it.');
  }
  const ledger = join(local, 'payer.db');
  if (!existsSync(ledger)) {
    if (['company.db','facilitator.db'].some(file => existsSync(join(local,file)))) throw new Error('Payment records exist without the payer ledger. Restore and inspect the original records; no new job will be created.');
    return [['apps/testnet/setup.ts'], ['apps/testnet/run.ts'], dashboard];
  }
  if (!existsSync(join(local, 'accounts.json'))) {
    throw new Error('A testnet ledger exists without its account configuration. Restore the existing configuration; do not create replacement wallets.');
  }
  const db = new DatabaseSync(ledger, { readOnly: true });
  let orders;
  try {
    orders = db.prepare('SELECT offer, payment, delivery FROM orders').all();
  } finally {
    db.close();
  }
  // Never provision/fund around an existing unresolved ledger or reset its shared budget.
  if (orders.length !== 2 || orders.some(order => order.payment !== 'settled' || order.delivery !== 'delivered')) {
    throw new Error('The existing testnet ledger is incomplete or has unresolved payments. Inspect it before recovery. No accounts, holds, or payments were changed.');
  }
  const operations = new Set(orders.map(order => JSON.parse(order.offer).operationId));
  if (!operations.has('research-report') || !operations.has('review-report')) {
    throw new Error('The existing ledger does not contain the two expected purchases. No replacement job will be created.');
  }
  return [['apps/testnet/run.ts', '--replay-only'], dashboard];
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm start              Local dashboard and simulated swarm; no blockchain calls.\nnpm run demo:testnet    Fresh testnet setup and two purchases, or safe replay of the existing completed job; then dashboard.\nKeep the terminal running. Ctrl-C stops the local application.');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--testnet')) {
    throw new Error('Unknown option. Use --help or --testnet.');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 12) throw new Error('Node 24.12 or newer within Node 24 is required.');
  const testnet = args[0] === '--testnet';
  const steps = planStartup(root, testnet);
  console.log(testnet
    ? 'NEAR TESTNET — fresh setup can create/fund dedicated test accounts and make two test-token purchases. Existing completed purchases use replay only.'
    : 'LOCAL WORKSPACE — the swarm uses simulated transactions. Starting the UI does not fund a wallet or submit a payment.');
  for (const step of steps) {
    if (step[0] === 'apps/dashboard/server.ts') {
      console.log('Swarm lab: http://127.0.0.1:8787/swarm\nRecorded NEAR purchases: http://127.0.0.1:8787/\nKeep this terminal running; Ctrl-C stops the application.');
    }
    const child = spawn(process.execPath, step, { cwd: root, stdio: 'inherit', env: process.env });
    const stop = signal => child.kill(signal);
    const interrupt = () => stop('SIGINT');
    const terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    }).finally(() => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    });
    if (result.signal || result.code !== 0) {
      process.exitCode = result.signal === 'SIGINT' ? 130 : result.signal === 'SIGTERM' ? 143 : result.code ?? 1;
      return;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : 'Startup failed.');
    process.exitCode = 1;
  });
}
