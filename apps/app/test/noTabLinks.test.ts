import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../src", import.meta.url));

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return sources(p);
		return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
	});
}

/** 通讯录页的 tab 参数已经删掉（好友与「我的 Bot」在同一页）：任何 ?tab= / &tab= 链接都是断链。 */
test("没有指向已删除 tab 参数的链接", () => {
	const hits: string[] = [];
	for (const file of sources(root)) {
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, i) => {
				if (/[?&]tab=/.test(line)) hits.push(`${file.replace(root, "src")}:${i + 1}: ${line.trim()}`);
			});
	}
	expect(hits).toEqual([]);
});
