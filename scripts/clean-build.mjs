import { globSync, rmSync } from "node:fs";

for (const path of globSync(["packages/*/dist", "plugins/*/dist", "apps/app/dist"])) {
	rmSync(path, { recursive: true, force: true });
}
