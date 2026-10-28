import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { expandTemplate } from "./templates.js";

test("prompt templates follow pi argument expansion and agent overrides", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-templates-"));
	try {
		await mkdir(join(home, "prompts"));
		await mkdir(join(home, "agents", "main", "prompts"), { recursive: true });
		await writeFile(join(home, "prompts", "review.md"), "home $1");
		await writeFile(
			join(home, "agents", "main", "prompts", "review.md"),
			"---\ndescription: Review\n---\n$1|$2|$@|${3:-fallback}|${@:2:1}|$ARGUMENTS",
		);
		expect(await expandTemplate(home, "main", '/review "two words" "$1"')).toBe(
			"two words|$1|two words $1|fallback|$1|two words $1",
		);
		expect(await expandTemplate(home, "other", "/review change")).toBe("home change");
		expect(await expandTemplate(home, null, "/missing hi")).toBe("/missing hi");
		expect(await expandTemplate(home, "main", "/../review")).toBe("/../review");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
