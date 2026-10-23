import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna uses official coding and research tasks and continues the same manual work session",
	async () => {
		const home = await mkdtemp("/tmp/yonder-task-presets-live-");
		const source = resolve("plugins/agent-presets/prompts/tasks");
		const sessions: string[] = [];
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			kernel = await openKernel(home);
			await kernel.management({
				action: "presets.create",
				id: "acceptance-parent",
				value: {
					description: "Isolated official-task integration acceptance",
					model: "openai/gpt-6-luna",
					thinking: "low",
					capabilities: ["read", "write", "exec", "network"],
					tools: { offer: ["task_run"], search: [] },
					skills: [],
				},
			});
			const parent = await kernel.sessions.open({ preset: "acceptance-parent", close: "manual" });
			sessions.push(parent.id);
			await kernel.sessions.submit(
				parent.id,
				{
					text: `Delegate exactly one bounded task with task_run. Send only preset and task arguments: preset coding; omit optional effort, sources and attachments. Task: Write ${home}/prompt-size.mjs using only Node built-ins. It must read the actual files general.md, coding.md and research.md from ${source}, count each file's Unicode characters using Array.from(text).length, and print a JSON object keyed by those three filenames. Run the script and return its actual output. Do not modify the source repository. After receiving the result, report it; do not launch another child.`,
				},
				{ wait: true },
			);
			const running = kernel;
			const children = (await kernel.sessions.list({})).filter((session) => session.parent === parent.id);
			expect(children).toHaveLength(1);
			const child = children[0]!;
			sessions.push(child.id);
			const expected = Object.fromEntries(
				await Promise.all(
					["general.md", "coding.md", "research.md"].map(async (name) => [
						name,
						Array.from(await readFile(`${source}/${name}`, "utf8")).length,
					]),
				),
			);
			await expect
				.poll(
					async () =>
						(await running.sessions.transcript(child.id, { limit: 200 })).flatMap((entry) => {
							if (entry.kind !== "pi.tool-result") return [];
							try {
								const result = JSON.parse(entry.text);
								return result.exitCode === 0 && typeof result.output === "string" ? [JSON.parse(result.output)] : [];
							} catch {
								return [];
							}
						}),
					{ timeout: 120000, interval: 500 },
				)
				.toContainEqual(expected);
			expect(existsSync(`${home}/prompt-size.mjs`)).toBe(true);
			const childTranscript = await kernel.sessions.transcript(child.id, { limit: 200 });
			expect(childTranscript.some((entry) => entry.tools?.some((tool) => tool.name === "bash"))).toBe(true);

			const work = await kernel.sessions.open({ preset: "default", close: "manual" });
			sessions.push(work.id);
			const first = await kernel.sessions.submit(
				work.id,
				{
					text: `Read ${home}/prompt-size.mjs. Explain what its character count measures and one limitation, in Chinese. Do not modify it.`,
				},
				{ wait: true },
			);
			expect(first.status).toBe("done");
			expect(first.text.trim()).not.toBe("");
			const second = await kernel.sessions.submit(
				work.id,
				{
					text: "Continue with that same script: identify the three input filenames and explain why this result is not a tokenizer's token count. Do not reread or change files.",
				},
				{ wait: true },
			);
			expect(second.status).toBe("done");
			for (const name of ["general.md", "coding.md", "research.md"]) expect(second.text).toContain(name);
			await kernel.sessions.close(work.id);
			const research = await kernel.sessions.open({ preset: "research" });
			sessions.push(research.id);
			const url =
				"https://raw.githubusercontent.com/anomalyco/opencode/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/LICENSE";
			const answer = await kernel.sessions.submit(
				research.id,
				{
					text: `Use web-tools_fetch to read ${url}. Report the actual license identifier and its copyright notice in Chinese, cite that URL, and distinguish permission to reuse prompt text from proof that our adapted agent works. Do not use search/extract or change files.`,
				},
				{ wait: true },
			);
			expect(answer.status).toBe("done");
			expect(answer.text).toContain("MIT");
			expect(answer.text).toContain(url);
			expect(
				(await kernel.sessions.transcript(research.id, { limit: 100 })).some((entry) =>
					entry.tools?.some((tool) => tool.name === "web-tools_fetch"),
				),
			).toBe(true);
		} finally {
			if (kernel) {
				await writeFile(
					`${home}/evidence.json`,
					JSON.stringify(
						{
							model: "openai/gpt-6-luna",
							home,
							sessions: await Promise.all(
								sessions.map(async (id) => ({ id, transcript: await kernel!.sessions.transcript(id, { limit: 300 }) })),
							),
							events: (await kernel.events.query({ limit: 1000 })).events,
						},
						null,
						2,
					),
				);
				await kernel.close();
			}
			console.info(`Official task evidence: ${home}`);
		}
	},
	360000,
);
