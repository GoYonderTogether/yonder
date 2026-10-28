import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../../../packages/core/src/config/index.js";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { terminalApi } from "../../../packages/core/src/kernel/terminal.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { Runtime } from "../../../packages/core/src/runtime/index.js";
import { createStore } from "../../../packages/core/src/store/index.js";
import { BoardService } from "../../tasks/src/service.js";
import { Store } from "../../tasks/src/store/index.js";
import { CompanionService } from "../src/service.js";
import { browser } from "./browser.js";

const native =
	process.env.YONDER_TEST_STATUS_BIN ?? resolve("packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus");
const execute = promisify(execFile);

test.skipIf(process.platform !== "darwin" || !existsSync(native))(
	"real runtime → scoped board token → secret summary → UI GET and native URLSession decode/bridge",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "yonder-ui-integrated-"));
		const db = await openDatabase(join(directory, "state.db"));
		const store = await createStore(db);
		let hold = false;
		let entered!: () => void;
		let release!: () => void;
		const gate = new Promise<void>((done) => {
			release = done;
		});
		const started = new Promise<void>((done) => {
			entered = done;
		});
		const runtime = await Runtime.open({
			home: directory,
			db,
			config: { schema: 1, retry: { maxRetries: 0 } },
			resolveSession: async () => ({
				agent: "main",
				profile: "activity",
				cwd: directory,
				resolved: resolveProfile({}),
			}),
			sections: async () => {
				if (hold) {
					entered();
					await gate;
				}
				throw new Error("Controlled pre-model integration failure");
			},
		});
		const agent = parseAgentConfig(
			"schema: 1\nid: main\nname: Integration test\nowner: person:owner\ndefaultProfile: owner\nprofiles:\n  owner: {}\nbindings: []\n",
		);
		const terminal = terminalApi({
			agents: new Map([["main", agent]]),
			store,
			sessions: {},
			runtime: () => runtime,
		} as Parameters<typeof terminalApi>[0]);
		const tasks = new Store(join(directory, "tasks"));
		const board = new BoardService(tasks, "zh-CN", 0);
		const companion = new CompanionService(join(directory, "companion"), false);
		let page: Awaited<ReturnType<typeof browser>> | undefined;
		const caller = {
			agent: "main",
			session: "integration",
			profile: "owner",
			capabilities: ["read"],
			env: {} as never,
			signal: new AbortController().signal,
		} as ToolContext;
		let pending: Promise<unknown> | undefined;
		const captured: unknown[] = [];
		try {
			await board.start();
			await companion.start();
			const task = tasks.open(
				{
					title: "Integration test item",
					objective: "Verify status transport",
					acceptance: ["Real transport verified"],
					nonGoals: [],
				},
				caller,
			);
			tasks.update(task.id, { state: "active" }, caller);
			tasks.update(task.id, { state: "blocked" }, caller);
			const source = board.publish(caller);
			expect((await fetch(`${source}?view=activity`)).status).toBe(200);
			expect(
				(
					await fetch(`${companion.url}board`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ source }),
					})
				).status,
			).toBe(200);
			const id = await runtime.create({ agent: "main", profile: "activity", cwd: directory });
			await store.sessions.put({
				id,
				agent: "main",
				profile: "activity",
				mode: "persistent",
				key: id,
				version: "integration",
				opened: new Date().toISOString(),
			});
			page = await browser();
			await page.command("Page.navigate", { url: companion.url });
			await page.wait("Boolean(window.yonderUI)");
			const currentPage = page;
			const check = async (state: string, label: string, emphasized = false) => {
				const row = (await terminal.activity())[0];
				if (!row) throw new Error("Missing real runtime agent row");
				const fixture = join(directory, "native-fixture.json");
				await writeFile(fixture, JSON.stringify({ agent: row, expected: { state, label, emphasized } }));
				// Node remains unblocked so the actual companion HTTP server handles native URLSession.
				const { stdout } = await execute(native, [
					"--check-activity-http",
					`${companion.url}activity-summary`,
					fixture,
				]);
				const bridge = JSON.parse(stdout);
				expect(bridge.activitySummary.availability).toBe("available");
				captured.push({ state, runtime: row, nativeBridge: bridge });
				// Without envelope, normal connected-page polling must fetch the real secret endpoint.
				await currentPage.evaluate(`window.yonderUI.activity(${JSON.stringify({ agents: [row], known: true })})`);
				await currentPage.wait(`document.querySelector('.agent-row')?.dataset.state === '${state}'`);
				expect(await currentPage.evaluate("document.querySelector('.agent-status').textContent")).toBe(label);
				// Then consume the exact native JSON shape at the bridge boundary (not a WKWebView claim).
				await currentPage.evaluate(`window.yonderUI.activity(${JSON.stringify(bridge)})`);
				expect(await currentPage.evaluate("document.querySelector('.agent-row').dataset.state")).toBe(state);
			};
			await check("blocked", "有阻塞事项");
			tasks.update(task.id, { state: "review" }, caller);
			await check("review", "待检查");
			hold = true;
			pending = runtime.submit(id, { text: "Integration prompt-section gate, no model request." });
			await started;
			await check("running", "运行中", true); // Historical review cannot cover current execution.
			release();
			await pending;
			hold = false;
			await check("blocked", "执行受阻");
			await runtime.abort(id);
			tasks.update(task.id, { state: "active" }, caller);
			await check("idle", "无执行");
			if (process.env.YONDER_UI_PREVIEW) {
				await mkdir(process.env.YONDER_UI_PREVIEW, { recursive: true });
				await writeFile(
					join(process.env.YONDER_UI_PREVIEW, "real-integration.json"),
					JSON.stringify(captured, null, 2),
				);
			}
		} finally {
			release();
			await pending;
			await page?.close();
			await companion.stop();
			await board.stop();
			await runtime.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
	30000,
);
