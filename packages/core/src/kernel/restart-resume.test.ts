import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna run interrupted by a restart resumes with a one-line interruption notice",
	async () => {
		const home = await mkdtemp("/tmp/yonder-restart-live-");
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const path = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(path, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["bash"] };
			await writeFile(path, stringify(agent));

			const first = await openKernel(home);
			const socket = createConnection(`${home}/.yonder/plugins/channel-cli/cli.sock`);
			await new Promise<void>((done, reject) => {
				socket.once("connect", done);
				socket.once("error", reject);
			});
			socket.write(
				'Call bash exactly once with command "sleep 12; printf RESTART_TOOL_DONE". Afterwards say RESTART_FINAL and stop.\n',
			);
			await expect
				.poll(async () => (await first.events.query({ type: "message.in" })).events.length, { timeout: 30000 })
				.toBe(1);
			await new Promise((done) => setTimeout(done, 6000));
			socket.destroy();
			await first.close();

			const second = await openKernel(home);
			try {
				const [session] = await second.sessions.list({});
				expect(session).toBeTruthy();
				await expect
					.poll(
						async () =>
							JSON.stringify(await second.sessions.transcript(session!.id, { limit: 500 })).includes(
								"was restarted or the connection was interrupted",
							),
						{ timeout: 60000 },
					)
					.toBe(true);
				await expect
					.poll(async () => (await second.events.query({ type: "run.end" })).events.length, { timeout: 120000 })
					.toBeGreaterThanOrEqual(1);
			} finally {
				await second.close();
			}
		} finally {
			await rm(`${home}/.yonder/auth.json`, { force: true });
		}
	},
	240000,
);
