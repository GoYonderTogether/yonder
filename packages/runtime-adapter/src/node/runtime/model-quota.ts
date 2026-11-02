import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type ModelQuotaStore, type QuotaWindow, ModelQuota as SharedModelQuota } from "../../runtime/model-quota.js";

export type { QuotaWindow } from "../../runtime/model-quota.js";
export { accountKey, parseRateLimits, QUOTA_WINDOW_MINUTES } from "../../runtime/model-quota.js";

export class ModelQuota extends SharedModelQuota {
	constructor(path: string, now: () => number = Date.now, report?: (error: unknown) => void) {
		const store: ModelQuotaStore = {
			async load() {
				let text: string;
				try {
					text = await readFile(path, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
					throw error;
				}
				try {
					return JSON.parse(text) as unknown;
				} catch {
					return undefined;
				}
			},
			async save(value: { version: 1; accounts: Record<string, QuotaWindow> }) {
				await mkdir(dirname(path), { recursive: true });
				const temp = `${path}.${process.pid}.tmp`;
				await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
				await rename(temp, path);
			},
		};
		super(store, now, report);
	}
}
