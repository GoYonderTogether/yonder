import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = realpathSync(resolve(root, 'packages/pi-durable'));
for (const consumer of ['packages/core', 'packages/sdk']) {
  const require = createRequire(resolve(root, consumer, 'package.json'));
  const resolved = realpathSync(require.resolve('@earendil-works/pi-durable'));
  if (!resolved.startsWith(`${workspace}${sep}`)) {
    throw new Error(`${consumer} resolves pi-durable outside workspace: ${resolved}`);
  }
  console.log(`${consumer} resolves pi-durable from workspace: ${resolved}`);
}
