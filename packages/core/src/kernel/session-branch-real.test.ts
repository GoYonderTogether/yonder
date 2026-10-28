import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { type HostCtx, registry } from "../control/methods.js";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH;
const providerConfig = process.env.YONDER_TEST_PROVIDER_CONFIG;
test.skipIf(
	process.env.YONDER_TEST_REAL !== "1" || !auth || !existsSync(auth) || !providerConfig || !existsSync(providerConfig),
)(
	"real model and gateway preserve forked conversation history",
	async () => {
		const home = await mkdtemp("/tmp/yb-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const configPath = join(home, "yonder.yaml");
			const config = parse(await readFile(configPath, "utf8"));
			config.models = { providers: { siliconflow: parse(await readFile(providerConfig as string, "utf8")) } };
			await writeFile(configPath, stringify(config));
			await mkdir(join(home, ".yonder"), { recursive: true });
			await copyFile(auth as string, join(home, ".yonder", "auth.json"));
			kernel = await openKernel(home);
			const session = await kernel.sessions.open({ preset: "default", close: "manual" });
			const first = await kernel.sessions.submit(
				session.id,
				{ text: "Remember the word ORCHARD. Reply OK." },
				{ wait: true },
			);
			expect(first.status).toBe("done");
			const entries = await kernel.sessions.transcript(session.id, { limit: 1000 });
			const at = entries.at(-1)?.id;
			if (!at) throw new Error("Missing conversation entry");
			const ctx = {
				kernel,
				home,
				principal: { id: "local", transport: "socket", kind: "local", scopes: ["read", "write", "admin", "owner"] },
			} as HostCtx;
			const signal = new AbortController().signal;
			const child = (await registry.call("sessions.fork", { id: session.id, at }, ctx, signal)) as { id: string };
			expect(await kernel.sessions.transcript(child.id, { limit: 1000 })).toEqual(entries);
			const next = await kernel.sessions.submit(
				child.id,
				{ text: "What word did I ask you to remember?" },
				{ wait: true },
			);
			expect(next.status).toBe("done");
			expect(next.text.toUpperCase()).toContain("ORCHARD");
			expect(await kernel.sessions.transcript(session.id, { limit: 1000 })).toEqual(entries);
			expect(await registry.call("sessions.tree", { id: child.id }, ctx, signal)).toEqual([
				{ id: session.id },
				{ id: child.id, parent: session.id, at },
			]);
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
