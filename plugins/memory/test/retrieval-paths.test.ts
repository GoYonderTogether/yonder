import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import type { Config } from "../src/config.js";
import { read } from "../src/retrieval.js";

test("private directory aliases require opt-in and origin follows the validated target", async () => {
	const root = await tempHome("memory-paths-");
	try {
		for (const directory of ["mine", "private", "me"]) await mkdir(join(root, directory));
		await writeFile(join(root, "private", "secret.md"), "private without frontmatter");
		await writeFile(join(root, "mine", "note.md"), "human note");
		const config = { root, timezone: "UTC" } as Config;
		const signal = new AbortController().signal;
		const aliases = ["private/secret.md", "./private/secret.md", "mine/../private/secret.md"];
		if (process.platform === "win32") aliases.push("private\\secret.md", "mine\\..\\PRIVATE\\secret.md");
		for (const path of aliases) {
			await expect(read(config, { path }, signal)).rejects.toThrow("includePrivate");
			expect((await read(config, { path, includePrivate: true }, signal)).text).toBe("private without frontmatter");
		}
		expect((await read(config, { path: "me/../mine/note.md" }, signal)).origin).toBe("human-written");
		const registered = { ...config, roots: [{ name: "notes", path: root, origin: "human" as const }] };
		await expect(read(registered, { path: "notes:mine/../private/secret.md" }, signal)).rejects.toThrow(
			"includePrivate",
		);
		await expect(read(config, { path: "../outside.md" }, signal)).rejects.toThrow("outside memory root");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
