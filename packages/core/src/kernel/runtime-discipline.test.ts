import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
// Optional real model other than the default, e.g. workbuddy/deepseek-v4.1-flash; its provider comes from the pi catalog.
const model = process.env.YONDER_TEST_MODEL;
const catalog = process.env.YONDER_TEST_MODELS ?? resolve(homedir(), ".pi/agent/models.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna: task report, one silent background fallback and deterministic interactive heartbeat",
	async () => {
		const home = await mkdtemp("/tmp/yonder-runtime-discipline-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let socket: Socket | undefined;
		const logs: unknown[] = [];
		try {
			await initHome(home, "owner", { model: testModel });
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			if (model) {
				const provider = model.slice(0, model.indexOf("/"));
				const providers = JSON.parse(readFileSync(catalog, "utf8")).providers;
				config.models = { providers: { [provider]: providers[provider] } };
			}
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const agentPath = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(agentPath, "utf8"));
			agent.defaults.contexts = [];
			if (model) agent.defaults.model = model;
			agent.profiles.owner.tools = { offer: ["task_run", "bash"] };
			agent.profiles.owner.thinking = "low";
			agent.bindings[0].stream = false;
			await writeFile(agentPath, stringify(agent));
			const presetPath = `${home}/presets/default.yaml`;
			const preset = parse(await readFile(presetPath, "utf8"));
			preset.thinking = "low";
			if (model) preset.model = model;
			preset.tools = { offer: ["read"] };
			await writeFile(presetPath, stringify(preset));
			kernel = await openKernel(home, {
				log: (level, message) => logs.push({ level, message }),
			});
			let running = kernel;
			socket = createConnection(`${home}/.yonder/plugins/channel-cli/cli.sock`);
			let client = socket;
			const packets: Array<{ type: string; text?: string; event?: YEvent }> = [];
			createInterface({ input: client }).on("line", (line) => packets.push(JSON.parse(line)));
			await new Promise<void>((done, reject) => {
				client.once("connect", done);
				client.once("error", reject);
			});
			const events = async () => (await running.events.query({ limit: 1000 })).events;
			const submit = async (text: string) => {
				const offset = packets.length;
				client.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
				await expect
					.poll(() => packets.slice(offset).find((p) => p.type === "accepted"), { timeout: 5000 })
					.toBeTruthy();
				return packets.slice(offset).find((p) => p.type === "accepted")!.event!;
			};
			const ended = async (event: YEvent) => {
				await expect
					.poll(
						async () =>
							(await events()).find(
								(e) => e.type === "run.end" && (e.data as { inputs: string[] }).inputs.includes(event.id),
							),
						{ timeout: 120000 },
					)
					.toBeTruthy();
			};
			const source = resolve("CONTRIBUTING.md");
			const task = await submit(
				`Call task_run exactly once with these exact arguments and no other fields: ${JSON.stringify({ preset: "default", task: `Goal: verify the documented default real model. Material: read ${source}. Boundaries: read only, no modifications. Done: identify the real-model default from that file. Stop: report blocked if unreadable. Return: first line STATUS: done|partial|blocked, then the actual path read, verified model name and remaining items.` })}. Omit sources, effort and attachments; the task text already supplies the material path. Then report the returned task result to me.`,
			);
			await ended(task);
			const children = (await running.sessions.list({})).filter((s) => s.mode === "task" && s.parent);
			expect(children).toHaveLength(1);
			const transcript = await running.sessions.transcript(children[0]!.id, { limit: 1000 });
			const report = transcript.filter((e) => e.kind === "pi.assistant").at(-1)?.text ?? "";
			expect(report).toMatch(/^STATUS: done\b/u);
			expect(report).toContain("gpt-6-luna");
			expect(report).toContain(source);

			const background = await submit(
				`For this delivery check call bash exactly once with background:true and command "sleep 5; wc -c '${source}'". After the background handle reply briefly that the job was accepted. Once its runtime.tool-result arrives, give only the control marker NO_REPLY; do not use any tools or send a message in that continuation. This checks the kernel completion notification.`,
			);
			await ended(background);
			await expect
				.poll(
					async () => (await events()).find((e) => e.type === "runtime.tool-result" && e.parent === background.id),
					{ timeout: 120000 },
				)
				.toBeTruthy();
			const completion = (await events()).find((e) => e.type === "runtime.tool-result" && e.parent === background.id)!;
			await ended(completion);
			await expect
				.poll(
					async () =>
						(await events()).filter(
							(e) =>
								e.type === "message.out" &&
								e.parent === completion.id &&
								(e.data as { text: string }).text.startsWith("✅ 后台任务"),
						).length,
					{ timeout: 15000 },
				)
				.toBe(1);
			const continuation = (await events()).find(
				(e) => e.type === "run.end" && (e.data as { inputs: string[] }).inputs.includes(completion.id),
			)!;
			expect((continuation.data as { replied: string }).replied).toBe("none");

			client.destroy();
			await kernel.close();
			kernel = await openKernel(home, {
				test: { heartbeatIntervalMs: 2500 },
				log: (level, message) => logs.push({ level, message }),
			});
			running = kernel;
			socket = createConnection(`${home}/.yonder/plugins/channel-cli/cli.sock`);
			client = socket;
			createInterface({ input: client }).on("line", (line) => packets.push(JSON.parse(line)));
			await new Promise<void>((done, reject) => {
				client.once("connect", done);
				client.once("error", reject);
			});

			const heartbeat = await submit(
				`Call bash exactly once with command "sleep 10; wc -l '${source}'" and background:false. Do not call process. After it completes report the actual line count and path. This is a real timed command check.`,
			);
			await ended(heartbeat);
			const beats = (await events()).filter(
				(e) =>
					e.type === "message.out" && e.parent === heartbeat.id && (e.data as { text: string }).text.startsWith("⏳"),
			);
			expect(beats.length).toBeGreaterThan(0);
			expect(beats.length).toBeLessThanOrEqual(6);
			expect(beats.some((e) => /已执行 [1-9]\d* 次工具/u.test((e.data as { text: string }).text))).toBe(true);
			const before = (await events()).length;
			await new Promise((r) => setTimeout(r, 3000));
			expect(
				(await events())
					.slice(before)
					.filter(
						(e) =>
							e.type === "message.out" &&
							e.parent === heartbeat.id &&
							(e.data as { text: string }).text.startsWith("⏳"),
					),
			).toHaveLength(0);
			expect(
				(await events()).filter(
					(e) =>
						e.type === "message.out" &&
						e.parent === completion.id &&
						(e.data as { text: string }).text.startsWith("✅ 后台任务"),
				),
			).toHaveLength(1);
			console.info(
				JSON.stringify({
					home,
					model: model ?? "openai/gpt-6-luna",
					report,
					backgroundFallbacks: 1,
					heartbeats: beats.map((e) => e.data),
					runs: (await events()).filter((e) => e.type === "run.end").map((e) => e.data),
				}),
			);
			await writeFile(`${home}/acceptance-events.json`, JSON.stringify(await events(), null, 2));
		} finally {
			socket?.destroy();
			if (kernel)
				await writeFile(
					`${home}/acceptance-events.json`,
					JSON.stringify((await kernel.events.query({ limit: 1000 })).events, null, 2),
				);
			await kernel?.close();
			await writeFile(`${home}/acceptance-log.json`, JSON.stringify(logs, null, 2));
			console.info(`Runtime discipline isolated evidence: ${home}`);
		}
	},
	240000,
);
