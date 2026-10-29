import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

const auth = resolve(".yonder/auth.json");
const model = "openai/gpt-6-luna";
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real model yields long bash, continues work, receives completion, preserves soft thresholds and runs a native child",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-execution-live-"));
		const evidence = `${home}/evidence`;
		await mkdir(evidence);
		const logs: unknown[] = [];
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let parentId: string | undefined;
		let failure: string | undefined;
		const prompt = [
			"This is one real execution acceptance task. Preserve this exact sequence and do not invent success.",
			`First call bash with command exactly: printf 'START\\n'; sleep 25; printf 'BACKGROUND_DONE\\n'; printf 'BACKGROUND_DONE\\n' > '${home}/background.done'`,
			"Do not set background=true: we are checking automatic 15-second yield. Do not set a kill timeout.",
			`When bash returns a background handle, immediately use write to create '${home}/independent.marker' with content 'INDEPENDENT_WORK_DONE'. This must happen without waiting for the background command.`,
			"Then use task_run with preset execution-child and task 'Reply exactly SUBTASK_DONE; do not call tools.' Confirm the actual child result.",
			"Before receiving automatic background completion, do not poll process or use sleep. You may end your initial response with WAITING_FOR_BACKGROUND and the real handle.",
			"On the automatic background completion input, call process action=status with the real bash background id, verify its successful terminal result and BACKGROUND_DONE output. Then reply exactly EXECUTION_LIVE_DONE.",
			"Elapsed time, turns and tokens thresholds are soft reminders; continue the necessary work. Do not rerun the command or create the background.done file yourself.",
		].join("\n");
		await writeFile(`${evidence}/prompt.txt`, prompt);
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			await writeFile(
				`${home}/presets/execution-parent.yaml`,
				stringify({
					schema: 1,
					description: "Real execution integration acceptance",
					model,
					thinking: "low",
					level: "standard",
					tools: { offer: ["bash", "write", "process", "task_run"], search: [] },
					limits: { maxMinutes: 0.05, maxTurns: 1, maxTokens: 1 },
				}),
			);
			await writeFile(
				`${home}/presets/execution-child.yaml`,
				stringify({
					schema: 1,
					description: "Real native child acceptance",
					model,
					thinking: "low",
					level: "readonly",
					tools: { offer: [], search: [] },
					limits: { maxTokens: 1, maxTurns: 1 },
				}),
			);
			kernel = await openKernel(home, {
				log: (level, message, data) => {
					logs.push({ time: new Date().toISOString(), level, message, data });
				},
			});
			const running = kernel;
			const parent = await kernel.sessions.open({ preset: "execution-parent", close: "manual" });
			parentId = parent.id;
			const receipt = await kernel.terminal.submit(parent.id, { text: prompt });
			await writeFile(`${evidence}/receipt.json`, JSON.stringify(receipt, null, 2));
			const started = Date.now();
			const events = async () => (await running.events.query({ limit: 1000 })).events;
			await expect
				.poll(
					async () =>
						(await events()).some(
							(event) =>
								event.type === "runtime.tool-result" &&
								(event.data as { session?: string; tool?: string }).session === parent.id &&
								(event.data as { tool?: string }).tool === "bash",
						),
					{ timeout: 120000, interval: 500 },
				)
				.toBe(true);
			await expect
				.poll(
					async () =>
						(await running.sessions.transcript(parent.id, { limit: 1000 })).some(
							(item) => item.kind === "pi.assistant" && item.text.trim() === "EXECUTION_LIVE_DONE",
						),
					{ timeout: 90000, interval: 1000 },
				)
				.toBe(true);
			const allEvents = await events();
			const transcript = await running.sessions.transcript(parent.id, { limit: 1000 });
			const serialized = JSON.stringify(transcript);
			const background = allEvents.find(
				(e) =>
					e.type === "runtime.tool-result" &&
					(e.data as { tool?: string; session?: string }).tool === "bash" &&
					(e.data as { session?: string }).session === parent.id,
			);
			expect(background).toBeTruthy();
			expect(
				transcript.some(
					(item) =>
						item.kind === "pi.tool-result" &&
						(() => {
							try {
								return typeof JSON.parse(item.text).background === "string";
							} catch {
								return false;
							}
						})(),
				),
			).toBe(true);
			expect(transcript.some((item) => item.tools?.some((tool) => tool.name === "process"))).toBe(true);
			expect(serialized).toContain("BACKGROUND_DONE");
			expect(transcript.some((item) => item.kind === "pi.tool-result" && item.text.includes("SUBTASK_DONE"))).toBe(
				true,
			);
			const independent = await stat(`${home}/independent.marker`),
				completed = await stat(`${home}/background.done`);
			expect(independent.mtimeMs).toBeLessThan(completed.mtimeMs);
			const warnings = allEvents
				.filter((e) => e.type === "runtime.warning" && (e.data as { session?: string }).session === parent.id)
				.map((e) => (e.data as { kind: string }).kind);
			expect(warnings).toEqual(expect.arrayContaining(["maxMinutes", "maxTurns", "maxTokens"]));
			const runs = allEvents.filter(
				(e) => e.type === "run.end" && (e.data as { session?: string }).session === parent.id,
			);
			expect(runs.length).toBeGreaterThan(0);
			expect(runs.every((e) => (e.data as { status: string }).status === "done")).toBe(true);
			const children = (await running.sessions.list({})).filter((s) => s.parent === parent.id);
			expect(children.length).toBeGreaterThan(0);
			const childNotices = transcript.filter(
				(item) =>
					item.kind === "yonder.notification" &&
					children.some((child) => item.text.startsWith(`Subtask session ${child.id}:`)),
			);
			const childWarnings = allEvents.filter(
				(event) =>
					event.type === "runtime.warning" &&
					children.some((child) => (event.data as { session?: string }).session === child.id),
			);
			for (const kind of ["maxTokens", "maxTurns"])
				expect(
					childWarnings.some(
						(warning) =>
							(warning.data as { kind?: string }).kind === kind &&
							childNotices.some((notice) => notice.event === warning.id),
					),
				).toBe(true);

			expect(
				children.some((child) =>
					allEvents.some(
						(e) =>
							e.type === "run.end" &&
							(e.data as { session?: string; status?: string }).session === child.id &&
							(e.data as { status?: string }).status === "done",
					),
				),
			).toBe(true);
			await writeFile(
				`${evidence}/checks.json`,
				JSON.stringify(
					{
						model,
						parent: parent.id,
						elapsedMs: Date.now() - started,
						independentMtime: independent.mtimeMs,
						backgroundMtime: completed.mtimeMs,
						warnings,
						childNotices,
						childWarnings,
						backgroundEvent: background?.id,
						runIds: runs.map((e) => ({ event: e.id, ...(e.data as object) })),
						children: children.map((s) => s.id),
					},
					null,
					2,
				),
			);
		} catch (error) {
			failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
			throw error;
		} finally {
			if (kernel) {
				const allEvents: YEvent[] = (await kernel.events.query({ limit: 1000 })).events;
				await writeFile(`${evidence}/events.json`, JSON.stringify(allEvents, null, 2));
				const sessions = await kernel.sessions.list({});
				await writeFile(`${evidence}/sessions.json`, JSON.stringify(sessions, null, 2));
				for (const session of sessions)
					await writeFile(
						`${evidence}/transcript-${session.id}.json`,
						JSON.stringify(await kernel.sessions.transcript(session.id, { limit: 1000 }), null, 2),
					);
				await kernel.close();
			}
			await writeFile(
				`${evidence}/result.json`,
				JSON.stringify(
					{ home, evidence, model, parent: parentId, status: failure ? "failed" : "passed", failure, logs },
					null,
					2,
				),
			);
			console.log(`EXECUTION_LIVE_EVIDENCE ${evidence}`);
		}
	},
	240000,
);
