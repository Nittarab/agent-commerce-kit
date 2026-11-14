import { readFileSync } from 'node:fs';
import { renderPolicy, validatePolicy } from './index.ts';

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) {
  console.error('Usage: node packages/policy/cli.ts <policy.json>');
  process.exitCode = 1;
} else {
  try {
    const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
    console.log(renderPolicy(validatePolicy(input)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
