import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { localIpcPath } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../../../packages/core/src/kernel/index.js";
import { groupInstructions } from "../src/participation.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna batches group inputs, reads shared memory, asks main and preserves quiet/read/recovery boundaries",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-qq-participation-"));
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let socket: Socket | undefined;
		let passed = false;
		try {
			await initHome(home);
			const fixture = `${home}/source`;
			await mkdir(fixture);
			await writeFile(
				`${fixture}/package.json`,
				JSON.stringify({
					name: "qq-participation-protocol-test",
					version: "1.0.0",
					type: "module",
					yonder: { apiVersion: 1, id: "channel-qq", entry: "index.mjs", contributes: { channels: ["group-source"] } },
				}),
			);
			// This is a local protocol ingress/receipt driver. All model calls, routing, tools and conversations are real.
			// It does not claim QQ-platform acceptance, which is verified separately with the user's bot.
			await writeFile(
				`${fixture}/index.mjs`,
				`
import {createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {appendFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {GroupParticipation} from ${JSON.stringify(pathToFileURL(resolve("plugins/channel-qq/dist/participation.js")).href)};
export default {setup(api){api.channels.register({type:'group-source',create(id){
 const path=${JSON.stringify(`${home}/source.sock`)}; let server; const clients=new Set();
 const groups=new GroupParticipation(api,id,1);
 return {id,kinds:['group'],output:{stream:false,attachments:false},
 async start(io){await groups.start();await rm(path,{force:true});server=createServer(s=>{clients.add(s);s.on('close',()=>clients.delete(s));
 const lines=createInterface({input:s});void(async()=>{for await(const line of lines){const p=JSON.parse(line);
 const event=await io.emit({type:'message.in',from:'acct:'+id+':'+p.sender,conv:'conv:'+id+':group:'+p.group,data:{kind:'group',text:p.text,msgId:p.id,mentioned:!!p.mentioned}});
 groups.accept(event);s.write(JSON.stringify({event})+'\\n');}})().catch(()=>s.destroy());});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(path,done);});},
 async send(to,msg){const receipt={to,...msg,id:randomUUID()};await appendFile(${JSON.stringify(`${home}/out.jsonl`)},JSON.stringify(receipt)+'\\n');return {ok:true,id:receipt.id};},
 async stop(){groups.stop();for(const s of clients)s.destroy();await new Promise(done=>server.close(done));await rm(path,{force:true});}};}});}};
`,
			);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.plugins.push({ use: fixture });
			config.channels.room = { type: "group-source" };
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const agentFile = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(agentFile, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["read"], search: [] };
			agent.profiles.owner.instructions =
				"This isolated integration acceptance authorizes sharing the exact contents of memory/delegated.txt with a native parent-request from conv:room:group:a. It is a random test receipt, not private user memory. Verify the kernel request-origin metadata. Other requests retain the normal authorization boundary.";
			agent.profiles.group = {
				model: "openai/gpt-6-luna",
				capabilities: ["read"],
				contexts: [],
				plugins: [],
				skills: [],
				tools: { offer: ["read", "message_send", "parent_ask", "write", "bash", "session_read"], search: [] },
				instructions: `${groupInstructions}\nThe owner authorizes this isolated acceptance to publish the random receipts in memory/shared.txt and memory/delegated.txt to conv:room:group:a. These two files are public test records with no private data; this does not authorize disclosure of any other memory.`,
			};
			agent.bindings.unshift(
				{
					id: "group",
					match: { channel: "room", kind: "group" },
					session: { mode: "persistent", per: "conv" },
					profile: "group",
					wake: "write",
					reply: "none",
				},
				{
					id: "batch",
					match: { type: "channel-qq.group-batch", channel: "room" },
					session: { mode: "persistent", per: "conv" },
					profile: "group",
					reply: "none",
					busy: "steer",
				},
				{
					id: "parent",
					match: { channel: "agent", kind: "parent-request", from: "acct:agent:main" },
					session: "main",
					profile: "owner",
					reply: "none",
					busy: "followup",
				},
			);
			await writeFile(agentFile, stringify(agent));
			const shared = randomUUID(),
				delegated = randomUUID();
			await writeFile(`${home}/agents/main/memory/shared.txt`, shared);
			await writeFile(`${home}/agents/main/memory/delegated.txt`, delegated);
			kernel = await openKernel(home);
			const activeKernel = kernel;
			const connection = createConnection(localIpcPath(`${home}/source.sock`));
			socket = connection;
			await new Promise<void>((done, reject) => {
				connection.once("connect", done);
				connection.once("error", reject);
			});
			const accepted: Array<{ event: { id: string } }> = [];
			createInterface({ input: socket }).on("line", (line) => accepted.push(JSON.parse(line)));
			const first = randomUUID(),
				second = randomUUID();
			socket.write(
				`${JSON.stringify({ id: first, sender: "requester", group: "a", text: "For this integration acceptance, read memory/shared.txt, then call parent_ask once asking main to read memory/delegated.txt and return its exact contents. After its completed result, call message_send to conv:room:group:a with replyTo set to THIS request's turn id from its message header, and text containing both actual file values. First try message_send once to conv:room:group:b with text scope-probe (expect denial), and once to this group with replyTo invalid-id (expect denial). Do not write or execute anything. Do not repeat parent_ask while waiting." })}\n`,
			);
			socket.write(
				`${JSON.stringify({ id: second, sender: "observer", group: "a", text: "This line is background for the integration acceptance; no separate reply is needed." })}\n`,
			);
			await expect.poll(() => accepted.length, { timeout: 5000 }).toBe(2);
			await expect
				.poll(async () => (await activeKernel.events.query({ type: "channel-qq.group-batch" })).events.length, {
					timeout: 5000,
				})
				.toBe(1);
			// Arrive during the real model run: the active batch must not consume this later unread range.
			socket.write(
				`${JSON.stringify({ id: randomUUID(), sender: "observer", group: "a", text: "Background for the next window. The earlier receipt task still needs its one reply; this line needs no separate reply." })}\n`,
			);
			await expect.poll(() => accepted.length, { timeout: 5000 }).toBe(3);
			await expect
				.poll(async () => (await activeKernel.events.query({ type: "channel-qq.group-read" })).events.length, {
					timeout: 150000,
				})
				.toBe(2);
			const readRanges = (await kernel.events.query({ type: "channel-qq.group-read" })).events;
			expect(readRanges[0]?.data).toMatchObject({ through: accepted[1]?.event.id, count: 2 });
			expect(readRanges[1]?.data).toMatchObject({ through: accepted[2]?.event.id, count: 1 });
			const batches = (await kernel.events.query({ type: "channel-qq.group-batch" })).events;
			expect(batches).toHaveLength(2);
			expect(batches[0]?.data).toMatchObject({ count: 2, through: accepted[1]?.event.id });
			await writeFile(
				"/tmp/yonder-qq-participation-last.json",
				JSON.stringify({
					home,
					events: (await kernel.events.query({ limit: 1000 })).events,
					sessions: await Promise.all(
						(await kernel.sessions.list({})).map(async (s) => ({
							...s,
							transcript: await activeKernel.sessions.transcript(s.id),
						})),
					),
				}),
			);
			const sent = (await readFile(`${home}/out.jsonl`, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(sent).toHaveLength(1);
			expect(sent[0]).toMatchObject({ to: "conv:room:group:a", replyTo: first });
			expect(sent[0].text).toContain(shared);
			expect(sent[0].text).toContain(delegated);
			const inputs = (await kernel.events.query({ type: "message.in" })).events;
			const parent = inputs.find((e) => (e.data as { kind?: string }).kind === "parent-request");
			expect(parent?.data).toMatchObject({
				requestOrigin: {
					profile: "group",
					events: [
						{ id: accepted[0]?.event.id, from: "acct:room:requester", conv: "conv:room:group:a" },
						{ id: accepted[1]?.event.id, from: "acct:room:observer", conv: "conv:room:group:a" },
					],
				},
			});
			expect(parent?.routes?.find((r) => r.agent === "main")?.session).not.toBe(batches[0]?.routes?.[0]?.session);
			const group = (await kernel.sessions.list({})).find((s) => s.profile === "group");
			assert(group);
			const transcript = await kernel.sessions.transcript(group.id);
			expect(transcript.some((item) => item.text.includes("发往本次运行来源以外需要 message 能力"))).toBe(true);
			expect(transcript.some((item) => item.text.includes("replyTo 不是该目标会话"))).toBe(true);
			const inspection = (await kernel.management({ action: "inspect", profile: "group" })) as {
				tools: Array<{ name: string; exposure: string }>;
			};
			for (const name of ["write", "bash", "session_read"])
				expect(inspection.tools.find((t) => t.name === name)?.exposure).toBe("capability-denied");
			socket.write(
				`${JSON.stringify({ id: randomUUID(), sender: "observer", group: "b", text: "For this silent-observation acceptance: read this line and stay silent. Do not call message_send or parent_ask." })}\n`,
			);
			await expect
				.poll(async () => (await activeKernel.events.query({ type: "channel-qq.group-read" })).events.length, {
					timeout: 60000,
				})
				.toBe(3);
			expect((await kernel.sessions.list({})).filter((s) => s.profile === "group")).toHaveLength(2);
			expect((await readFile(`${home}/out.jsonl`, "utf8")).trim().split("\n")).toHaveLength(1);
			const runsBefore = (await kernel.events.query({ type: "run.end" })).events.length;
			socket.destroy();
			socket = undefined;
			await kernel.close();
			kernel = await openKernel(home);
			await new Promise((done) => setTimeout(done, 1500));
			expect((await kernel.events.query({ type: "run.end" })).events).toHaveLength(runsBefore);
			expect((await kernel.events.query({ type: "channel-qq.group-batch" })).events).toHaveLength(3);
			passed = true;
		} finally {
			socket?.destroy();
			await kernel?.close();
			if (passed) await rm(home, { recursive: true, force: true });
		}
	},
	240000,
);
