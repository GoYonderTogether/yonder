import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = realpathSync(resolve(root, 'packages/pi-durable'));
for (const consumer of ['packages/core', 'packages/sdk']) {
  const packagePath = realpathSync(
    resolve(root, 'node_modules/@earendil-works/pi-durable'),
  );
  if (packagePath !== workspace) {
    throw new Error(`${consumer} resolves pi-durable outside workspace: ${packagePath}`);
  }
  console.log(`${consumer} resolves pi-durable workspace: ${packagePath}`);
}
