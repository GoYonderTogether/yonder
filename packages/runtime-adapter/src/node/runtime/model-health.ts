import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type ModelHealthRecord, ModelHealth as SharedModelHealth } from "../../runtime/model-health.js";

export type { ModelHealthRecord };

export class ModelHealth extends SharedModelHealth {
	constructor(path: string, now: () => number = Date.now) {
		super(
			{
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
				async save(value) {
					await mkdir(dirname(path), { recursive: true });
					const temp = `${path}.${process.pid}.tmp`;
					await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
					await rename(temp, path);
				},
			},
			now,
		);
	}
}
