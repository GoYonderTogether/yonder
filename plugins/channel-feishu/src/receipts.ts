import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Persisted protocol receipts (dedupe ledger); a missing file is an empty ledger. */
export async function readReceipts(directory: string): Promise<Array<[string, string]>> {
	try {
		const rows: unknown = JSON.parse(await readFile(join(directory, "receipts.json"), "utf8"));
		if (!Array.isArray(rows)) throw new Error("Invalid Feishu receipt file");
		return rows.map((row) => {
			if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || typeof row[1] !== "string")
				throw new Error("Invalid Feishu receipt");
			return [row[0], row[1]];
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return [];
	}
}
