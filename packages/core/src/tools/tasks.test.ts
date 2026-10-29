import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real task_run forwards explicit input, returns native artifacts and rejects attachment scope escape",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-task-repair-"));
		const outside = await mkdtemp(join(tmpdir(), "yonder-outside-"));
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home);
			await writeFile(`${home}/input.txt`, "explicit-task-input");
			await writeFile(`${outside}/denied.txt`, "scope-check");
			const plugin = `${home}/artifacts`;
			await mkdir(plugin);
			await writeFile(
				`${plugin}/package.json`,
				JSON.stringify({
					name: "repair-artifacts",
					version: "1.0.0",
					type: "module",
					yonder: {
						apiVersion: 1,
						id: "repair-artifacts",
						entry: "index.mjs",
						contributes: {
							tools: ["repair-artifacts_produce_report"],
							presets: ["repair-parent", "repair-child", "scope-check"],
						},
					},
				}),
			);
			await writeFile(
				`${plugin}/index.mjs`,
				`
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
export default {async setup(api) {
  await mkdir(api.paths.data, {recursive:true});
  for (const [id, tools, capabilities, plugins] of [
    ["repair-parent", ["task_run"], ["read"], []],
    ["repair-child", ["repair-artifacts_produce_report"], ["read"], ["repair-artifacts"]],
    ["scope-check", ["message_send"], ["read", "message"], []]
  ]) api.presets.register({id, description:id, model:"openai/gpt-6-luna", tools:{offer:tools}, capabilities, plugins, limits:{maxMinutes:1}});
  api.tools.register({name:"repair-artifacts_produce_report", description:"Read the explicitly attached input and produce its report", capabilities:["read"], parameters:{type:"object",properties:{},additionalProperties:false},
    async execute(_args, ctx) {
      const attachments = ctx.events[0].data.attachments;
      if (attachments.length !== 1) throw new Error("Expected exactly one explicit attachment");
      const text = await readFile(fileURLToPath(attachments[0].uri), "utf8");
      const path = api.paths.data + "/report-" + ctx.session + ".txt";
      await writeFile(path, text);
      return {text:"Report produced", attachments:[{kind:"file",mime:"text/plain",uri:pathToFileURL(path).href}]};
    }
  });
}};`,
			);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.plugins.push({ use: plugin });
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			kernel = await openKernel(home);
			const parent = await kernel.sessions.open({ preset: "repair-parent" });
			const attachment = { kind: "file" as const, mime: "text/plain", uri: pathToFileURL(`${home}/input.txt`).href };
			const result = await kernel.sessions.submit(
				parent.id,
				{
					text: `Call task_run once with preset repair-child, task "Call repair-artifacts_produce_report exactly once, then reply report-complete", and attachments exactly ${JSON.stringify([attachment])}. Return the child's result.`,
					attachments: [attachment],
				},
				{ wait: true },
			);
			expect(result.status, result.reason).toBe("done");
			expect(result.attachments).toHaveLength(1);
			expect(await readFile(new URL(result.attachments![0]!.uri), "utf8")).toBe("explicit-task-input");
			const child = (await kernel.sessions.list({})).find((session) => session.parent === parent.id);
			expect(child?.closed).toBeTruthy();
			const transcript = await kernel.sessions.transcript(parent.id);
			expect(
				transcript.some((item) => item.kind === "pi.tool-result" && item.text.includes(`"session":"${child?.id}"`)),
			).toBe(true);
			const guarded = await kernel.sessions.open({ preset: "scope-check" });
			await kernel.sessions.submit(
				guarded.id,
				{
					text: `Call message_send once with to conv:cli:scope-check, text scope-check and attachments ${JSON.stringify([{ ...attachment, uri: pathToFileURL(`${outside}/denied.txt`).href }])}. This is a permission regression check; let the tool reject it, then report its result.`,
				},
				{ wait: true },
			);
			expect(
				(await kernel.sessions.transcript(guarded.id)).some((item) => item.text.includes("文件路径超出当前工作区")),
			).toBe(true);
			expect((await kernel.events.query({ type: "message.attempt" })).events).toHaveLength(0);
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	},
	150000,
);

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"parent abort projects its admitted child's native terminal receipt",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-child-abort-"));
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home);
			const path = `${home}/yonder.yaml`,
				config = parse(await readFile(path, "utf8"));
			config.credentials = auth;
			await writeFile(path, stringify(config));
			for (const [id, tools] of [
				["abort-parent", ["task_run"]],
				["abort-child", ["bash"]],
			] as const)
				await writeFile(
					`${home}/presets/${id}.yaml`,
					stringify({
						schema: 1,
						description: id,
						model: "openai/gpt-6-luna",
						capabilities: ["read", "exec"],
						tools: { offer: tools },
						plugins: [],
						contexts: [],
					}),
				);
			kernel = await openKernel(home);
			const parent = await kernel.sessions.open({ preset: "abort-parent" });
			await kernel.sessions.submit(
				parent.id,
				{
					text: 'Call task_run exactly once, preset abort-child, task "Run bash sleep 25 then reply child-complete". Do not use other tools.',
				},
				{ wait: false },
			);
			let child: Awaited<ReturnType<typeof kernel.sessions.get>>;
			await expect
				.poll(
					async () => {
						child = (await kernel!.sessions.list({})).find((item) => item.parent === parent.id);
						return (
							child &&
							(await kernel!.sessions.transcript(child.id)).some((item) =>
								item.tools?.some((tool) => tool.name === "bash"),
							)
						);
					},
					{ timeout: 30000 },
				)
				.toBe(true);
			await kernel.sessions.abort(parent.id);
			await expect.poll(async () => (await kernel!.sessions.get(child!.id))?.closed, { timeout: 5000 }).toBeTruthy();
			const ends = (await kernel.events.query({ type: "run.end" })).events.filter(
				(event) => (event.data as { session?: string }).session === child!.id,
			);
			expect(ends).toHaveLength(1);
			expect(ends[0]?.data).toMatchObject({ status: "aborted" });
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	60000,
);
