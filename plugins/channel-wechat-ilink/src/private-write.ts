import { randomUUID } from "node:crypto";
import { chmod, rename, writeFile } from "node:fs/promises";

export async function privateWrite(file: string, value: unknown): Promise<void> {
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
	await rename(temp, file);
	await chmod(file, 0o600);
}
