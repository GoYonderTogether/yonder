import { copyFile, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { metadata, textFiles } from "../src/files.js";
import { Ingest } from "../src/ingest.js";
import { manifest } from "../src/manifest.js";
import { event, harness } from "./harness.js";

const active: Array<Awaited<ReturnType<typeof harness>>> = [];
afterEach(async () => {
	for (const h of active.splice(0)) await h.dispose();
});
async function setup(extra = {}) {
	const h = await harness(extra);
	active.push(h);
	return h;
}
it("captures only owner on allowlisted channel; skips commands/empty messages and copies bounded attachments", async () => {
	const h = await setup({ capture: { channels: ["test"], maxAttachmentBytes: 5 } }),
		ingest = new Ingest(h.api, h.config, []);
	const attachment = join(h.root, "input.txt");
	await writeFile(attachment, "123");
	for (const e of [
		event("message.in", "acct:test:other"),
		event("message.in", "acct:other:owner"),
		event("message.in", "acct:test:owner", { text: "/help" }),
		event("message.in", "acct:test:owner", { text: "" }),
	])
		await ingest.chat(e);
	expect(await readdir(join(h.root, "timeline"))).toEqual([]);
	const e = event("message.in", "acct:test:owner", {
		text: "采集边界\n\n原文",
		attachments: [{ uri: attachment, mime: "text/plain", bytes: 3, name: "a.txt" }],
	});
	await ingest.chat(e);
	await ingest.chat(e);
	const weeks = (await textFiles(h.root)).filter((p) => /W\d\d\.md$/.test(p));
	const text = await readFile(join(h.root, weeks[0]!), "utf8");
	expect(text.match(/\{chat\}/g)).toHaveLength(1);
	expect(text).toContain("附件: a.txt (text/plain, 3) → inbox");
	expect(await readdir(join(h.root, "inbox"))).toHaveLength(1);
	expect(h.events).toHaveLength(0);
});
it("moves text originals byte-for-byte, indexes origin by path and archives duplicates without another capture", async () => {
	const h = await setup(),
		ingest = new Ingest(h.api, h.config, []),
		text = "---\norigin: agent\n---\n外部原件\r\n";
	await writeFile(join(h.root, "inbox/a.md"), text);
	await ingest.process("a.md", (e) => h.api.events.emit(e));
	const state = await manifest(h.root),
		path = Object.keys(state.files)[0]!;
	expect(await readFile(join(h.root, path), "utf8")).toBe(text);
	expect((await h.run("search", { terms: ["外部原件"], zones: ["raw"], origin: ["external"] })).total).toBe(1);
	await writeFile(join(h.root, "inbox/b.md"), text);
	await ingest.process("b.md", (e) => h.api.events.emit(e));
	expect(h.events).toHaveLength(1);
	expect(await readdir(join(h.root, "archive/duplicates"))).toHaveLength(1);
});
it("enforces converter input size, regular-file and content-type boundaries; allows a matching fixture", async () => {
	const converter = { command: process.execPath, args: ["-e", "process.stdout.write('converted fixture')"] };
	const tooLarge = await setup({ converter, capture: { maxAttachmentBytes: 4 } });
	await writeFile(join(tooLarge.root, "inbox/large.pdf"), "%PDF-1.7");
	await expect(new Ingest(tooLarge.api, tooLarge.config, []).process("large.pdf", () => {})).rejects.toThrow(
		"size limit",
	);
	const mismatch = await setup({ converter });
	await writeFile(join(mismatch.root, "inbox/fake.pdf"), "not a PDF");
	await expect(new Ingest(mismatch.api, mismatch.config, []).process("fake.pdf", () => {})).rejects.toThrow(
		"mismatched",
	);
	const linked = await setup({ converter });
	await writeFile(join(linked.root, "outside.pdf"), "%PDF-1.7");
	await symlink(join(linked.root, "outside.pdf"), join(linked.root, "inbox/link.pdf"));
	await expect(new Ingest(linked.api, linked.config, []).process("link.pdf", () => {})).rejects.toThrow(
		"Symbolic links",
	);
	const valid = await setup({ converter });
	await writeFile(join(valid.root, "inbox/good.pdf"), "%PDF-1.7 fixture");
	await new Ingest(valid.api, valid.config, []).process("good.pdf", () => {});
	expect((await textFiles(valid.root)).some((name) => name.endsWith(".converted.md"))).toBe(true);
});
it("keeps originals for real converter nonzero/empty/timeout failures", async () => {
	for (const converter of [
		{ command: "/usr/bin/false" },
		{ command: "/usr/bin/true" },
		{ command: process.execPath, args: ["-e", "setTimeout(()=>{},10000)"], timeoutSeconds: 0.05 },
	]) {
		const h = await setup({ converter }),
			ingest = new Ingest(h.api, h.config, []);
		await writeFile(join(h.root, "inbox/a.pdf"), "%PDF-1.7 不可转换测试文件");
		await expect(ingest.process("a.pdf", (e) => h.api.events.emit(e))).rejects.toThrow("Conversion failed");
		expect(await readdir(join(h.root, "inbox"))).toEqual(["a.pdf"]);
		expect(h.events).toHaveLength(0);
	}
});
it("watcher actually ingests a stable file and stop releases the watcher", async () => {
	const h = await setup({ inbox: { rescanSeconds: 0.2 } }),
		errors: string[] = [],
		ingest = new Ingest(h.api, h.config, errors),
		trigger = ingest.trigger();
	await trigger.start({ emit: (e) => h.api.events.emit(e) });
	try {
		await writeFile(join(h.root, "inbox/watched.txt"), "真实文件监听");
		await expect.poll(() => h.events.length, { timeout: 6000 }).toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await trigger.stop();
	}
});
const converter = process.env.MEMORY_TEST_CONVERTER;
it.skipIf(!converter)(
	"converts actual PDF/docx and Chinese compatibility characters with installed markitdown",
	{ timeout: 60000 },
	async () => {
		const h = await setup({ converter: { command: converter! } }),
			ingest = new Ingest(h.api, h.config, []);
		const samples = (process.env.MEMORY_TEST_SAMPLES ?? "").split("|").filter(Boolean);
		expect(samples).toHaveLength(4);
		for (const [i, sample] of samples.entries()) {
			const name = `sample-${i}.${sample.endsWith("docx") ? "docx" : "pdf"}`;
			await copyFile(sample, join(h.root, "inbox", name));
			await ingest.process(name, (e) => h.api.events.emit(e));
		}
		const converted = (await textFiles(h.root)).filter((p) => p.endsWith(".converted.md"));
		expect(converted).toHaveLength(4);
		for (const p of converted) {
			const text = await readFile(join(h.root, p), "utf8");
			expect(text).toBe(text.normalize("NFKC"));
			expect(metadata(text)).toMatchObject({ origin: "external", converted: true });
		}
		expect(h.events).toHaveLength(4);
		expect((await h.run("search", { terms: ["文"], zones: ["raw"] })).total).toBeGreaterThan(0);
	},
);
