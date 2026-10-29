import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterAll, expect, test } from "vitest";
import { githubTarget } from "./github.js";

const source = "./index.ts";
const { default: plugin } = await import(source);

// Real public requests: no fetch stub and no model stand-in, so a network failure fails the test.
const PDF_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const GITHUB_FILE = "https://github.com/nodejs/node/blob/main/README.md";
const root = await mkdtemp(join(tmpdir(), "web-tools-docs-"));
const directory = join(root, "cache", "tool-output", "7");
await mkdir(directory, { recursive: true });
afterAll(() => rm(root, { recursive: true, force: true }));

function context(overrides: Partial<ToolContext> = {}) {
	return {
		signal: new AbortController().signal,
		session: "7",
		cacheToolOutput: undefined,
		cacheToolOutputStream: undefined,
		env: { readTextFile: async () => ({ ok: false, error: { message: "not_found" } }) },
		...overrides,
	} as unknown as ToolContext;
}
function tools() {
	const { api, registrations } = createRegistrationCollector();
	plugin.setup({ ...api, id: "web-tools", config: undefined, credentials: { get: async () => undefined } } as unknown as PluginAPI);
	return {
		run: (name: string, args: unknown, ctx: ToolContext = context()) => {
			const tool = registrations.tools.find((candidate) => candidate.name === `web-tools_${name}`);
			if (!tool) throw new Error(`Missing tool ${name}`);
			return Promise.resolve().then(() => tool.execute(args, ctx));
		},
	};
}

test("fetch extracts text from a public PDF and keeps the payload readable by responseId", async () => {
	let files = 0;
	const cache = async (value: string | AsyncIterable<Uint8Array>) => {
		if (typeof value !== "string") throw new Error("unexpected stream");
		const path = join(directory, `${++files}.json`);
		await writeFile(path, value);
		return path;
	};
	const env = { readTextFile: async (target: string) => ({ ok: true, value: await readFile(target, "utf8") }) };
	const ctx = context({ cacheToolOutput: cache, env: env as unknown as ToolContext["env"] });
	const { run } = tools();
	const payload = JSON.parse((await run("fetch", { url: PDF_URL }, ctx)).text);
	expect(payload).toMatchObject({ source: "pdf", doc: "pdf", mime: "application/pdf", format: "text", pages: 1 });
	expect(payload.content).toContain("Dummy PDF file");
	expect(payload.responseId).toBe(join(directory, "1.json"));
	const found = JSON.parse(
		(await run("get_search_content", { responseId: payload.responseId, findText: "Dummy PDF" }, ctx)).text,
	);
	expect(found.matchCount).toBeGreaterThan(0);
	expect(found.text).toContain("Dummy PDF");
});

test("fetch reads a public GitHub file through raw content", async () => {
	const payload = JSON.parse((await tools().run("fetch", { url: GITHUB_FILE })).text);
	expect(payload).toMatchObject({ source: "github", doc: "file" });
	expect(payload.url).toBe("https://raw.githubusercontent.com/nodejs/node/main/README.md");
	expect(payload.content).toContain("Node.js");
});

test("github URLs resolve to raw files, API repositories and listings", () => {
	const file = githubTarget(new URL(GITHUB_FILE));
	expect(file).toEqual({ kind: "file", owner: "nodejs", repo: "node", ref: "main", path: "README.md" });
	expect(githubTarget(new URL("https://github.com/nodejs/node"))).toEqual({
		kind: "repo",
		owner: "nodejs",
		repo: "node",
	});
	expect(githubTarget(new URL("https://github.com/nodejs/node/tree/main/lib"))).toEqual({
		kind: "dir",
		owner: "nodejs",
		repo: "node",
		ref: "main",
		path: "lib",
	});
	expect(githubTarget(new URL("https://github.com/nodejs/node/issues/1"))).toBeUndefined();
	expect(githubTarget(new URL("https://example.org/nodejs/node"))).toBeUndefined();
});
