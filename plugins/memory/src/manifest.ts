import { type MemoryRoot, readText } from "./files.js";
import type { Origin } from "./records.js";
import { type Store, serial, type WriteContext } from "./store.js";
export interface Manifest {
	files: Record<string, { origin: Origin; sha256?: string }>;
	hashes: Record<string, string>;
	keys: Record<string, string>;
}
export function parseManifest(text: string): Manifest {
	const data = JSON.parse(text);
	return { files: data.files ?? {}, hashes: data.hashes ?? {}, keys: data.keys ?? {} };
}
export async function manifest(root: MemoryRoot): Promise<Manifest> {
	try {
		return parseManifest(await readText(root, ".memory/manifest.json"));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return { files: {}, hashes: {}, keys: {} };
		throw e;
	}
}
export async function once(store: Store, key: string, ctx: WriteContext, run: (state: Manifest) => Promise<string>) {
	return serial(store.files.localRoot ? `${store.root}/.memory/ingest` : store.files, async () => {
		const state = await manifest(store.files);
		if (state.keys[key]) return false;
		const path = await run(state);
		state.keys[key] = path;
		await store.edit(".memory/manifest.json", () => JSON.stringify(state), ctx);
		return true;
	});
}
