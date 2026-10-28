import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";

const GOLDEN = new URL("../golden/tool-context.json", import.meta.url);

test("ToolContext cache API keeps its golden signature", () => {
	const source = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
	const context = source.match(/export interface ToolContext \{([\s\S]*?)\n\}/)?.[1];
	const current = context?.match(/\bcacheToolOutput\??\([^\n]+/)?.[0];
	const authorizeFileWrite = context?.match(/\bauthorizeFileWrite\??\([^\n]+/)?.[0];
	if (!current) throw new Error("ToolContext cacheToolOutput missing");
	if (process.env.UPDATE_GOLDEN === "1")
		writeFileSync(GOLDEN, `${JSON.stringify({ cacheToolOutput: current, authorizeFileWrite }, null, "\t")}\n`);
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { cacheToolOutput: string; authorizeFileWrite: string };
	expect(current).toBe(golden.cacheToolOutput);
	expect(authorizeFileWrite).toBe(golden.authorizeFileWrite);
});
