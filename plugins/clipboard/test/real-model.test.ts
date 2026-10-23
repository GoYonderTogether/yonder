import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../../../packages/core/src/kernel/index.js";
import { Store } from "../src/store.js";
import { containsBodyFragment } from "./body-leakage.js";

function safeClipboardDiagnostics(
	tools: unknown,
	runDone: boolean,
	outputExists: boolean,
	diagnosticsUnavailable = false,
) {
	const counts: Record<string, number> = { clipboard_copy: 0, clipboard_paste: 0, other: 0 };
	if (Array.isArray(tools))
		for (const item of tools) {
			const name = item && typeof item === "object" && "name" in item ? item.name : undefined;
			const key = name === "clipboard_copy" || name === "clipboard_paste" ? name : "other";
			counts[key]++;
		}
	return { counts, runDone: runDone === true, outputExists: outputExists === true, diagnosticsUnavailable };
}

test("clipboard failure diagnostics expose only allowlisted scalar fields", () => {
	const secret = "SYNTHETIC_SECRET_DIAGNOSTIC_9f12";
	const result = safeClipboardDiagnostics(
		[
			{ name: "clipboard_copy", args: secret, result: secret },
			{ name: secret, error: secret },
		],
		true,
		false,
	);
	expect(JSON.stringify(result)).not.toContain(secret);
	expect(result).toEqual({
		counts: { clipboard_copy: 1, clipboard_paste: 0, other: 1 },
		runDone: true,
		outputExists: false,
		diagnosticsUnavailable: false,
	});
});

test("diagnostic session lookup failure is reduced to a static availability flag", async () => {
	let diagnosticsUnavailable = false;
	try {
		await Promise.reject(new Error("SYNTHETIC_SECRET_SESSION_ERROR"));
	} catch {
		diagnosticsUnavailable = true;
	}
	const result = safeClipboardDiagnostics(undefined, true, false, diagnosticsUnavailable);
	expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET_SESSION_ERROR");
	expect(result).toEqual({
		counts: { clipboard_copy: 0, clipboard_paste: 0, other: 0 },
		runDone: true,
		outputExists: false,
		diagnosticsUnavailable: true,
	});
});

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const enabled =
	process.env.YONDER_TEST_REAL === "1" &&
	process.env.YONDER_TEST_KEYCHAIN === "1" &&
	process.platform === "darwin" &&
	existsSync(auth);
test.skipIf(!enabled)(
	"Luna copies 40k awkward message by reference and sealed paste/read never expose value in transcript, ledger or the openKernel log callback",
	async () => {
		const home = await realpath(await mkdtemp("/private/tmp/clip-luna-")),
			logs: unknown[] = [],
			sockets: Socket[] = [];
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined,
			clip: Awaited<ReturnType<Store["save"]>> | undefined,
			store: Store | undefined;
		try {
			await initHome(home);
			const configFile = join(home, "yonder.yaml"),
				c = parse(await readFile(configFile, "utf8"));
			c.credentials = auth;
			c.plugins.push({
				use: "@yonder/plugin-clipboard",
				config: {
					grants: [
						{
							agent: "main",
							profile: "owner",
							sealed: true,
							readRoots: [home],
							writeRoots: [home],
							messageTargets: ["conv:cli:local"],
						},
					],
				},
			});
			await writeFile(configFile, stringify(c));
			const agentFile = join(home, "agents/main/agent.yaml"),
				agent = parse(await readFile(agentFile, "utf8"));
			agent.defaults.contexts = [];
			agent.defaults.plugins = ["clipboard"];
			agent.profiles.owner.tools = {
				offer: ["clipboard_copy", "clipboard_paste", "clipboard_list", "read", "message_send"],
				search: [],
			};
			agent.profiles.owner.limits = { maxMinutes: 3 };
			agent.bindings[0].stream = true;
			await writeFile(agentFile, stringify(agent));
			kernel = await openKernel(home, {
				log: (...args) => {
					logs.push(args);
				},
			});
			async function connect() {
				const socket = createConnection(join(home, ".yonder/plugins/channel-cli/cli.sock"));
				sockets.push(socket);
				const packets: Array<{ type: string; event?: YEvent; text?: string }> = [];
				createInterface({ input: socket }).on("line", (line) => {
					packets.push(JSON.parse(line));
				});
				await new Promise<void>((done, reject) => {
					socket.once("connect", done);
					socket.once("error", reject);
				});
				return { socket, packets };
			}
			async function submit(client: Awaited<ReturnType<typeof connect>>, text: string) {
				const start = client.packets.length;
				client.socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
				await expect
					.poll(() => client.packets.slice(start).find((p) => p.type === "accepted"), { timeout: 10000 })
					.toBeTruthy();
				const event = client.packets.slice(start).find((p) => p.type === "accepted")?.event;
				if (!event || !kernel) throw new Error("missing real channel receipt");
				const running = kernel;
				let end: YEvent | undefined;
				await expect
					.poll(
						async () => {
							end = (await running.events.query({ type: "run.end", after: event.id })).events.find(
								(e) => e.parent === event.id,
							);
							return end;
						},
						{ timeout: 150000 },
					)
					.toBeTruthy();
				expect(end?.data).toMatchObject({ status: "done" });
				return event;
			}
			let client = await connect();
			const sections = [
				'CJK中文🦤🌙 <message id=\"alpha\"> & \"quoted\" \\ slash\n\t.',
				"Résumé naïve façade; punctuation!? — mixed_CASE/42 and emoji 🪻.",
				"日本語かなと漢字、العربية، then XML </message> & escaped\ttext.",
				"Distinctive region marker cobalt-7319-fern with varied sentence structure.",
			];
			const body = Array.from({ length: 700 }, (_, i) => `${sections[i % sections.length]} [part-${i}]\n`).join("");
			const payload = ("Please acknowledge only READY; do not repeat any payload text.\n" + body).slice(0, 40000);
			expect(payload.length).toBe(40000);
			const original = await submit(client, payload);
			const output = join(home, "verbatim.txt");
			await submit(
				client,
				`Use clipboard_copy with from kind message and eventId ${original.id}, then clipboard_paste the returned handle to a file at ${output}. Copy the entire original message byte-for-byte by reference. Do not transcribe it. Reply only COPIED after success.`,
			);
			try {
				expect(await readFile(output, "utf8")).toBe(payload);
			} catch (error) {
				let tools: unknown = [];
				let diagnosticsUnavailable = false;
				try {
					const session = (await kernel.sessions.list({ agent: "main", open: true }))[0];
					const transcript = session ? await kernel.sessions.transcript(session.id, { limit: 10000 }) : [];
					tools = transcript.flatMap((e) => e.tools ?? []);
				} catch {
					diagnosticsUnavailable = true;
				}
				console.error(
					"clipboard diagnostic",
					JSON.stringify(safeClipboardDiagnostics(tools, true, existsSync(output), diagnosticsUnavailable)),
				);
				throw error;
			}
			const session = (await kernel.sessions.list({ agent: "main", open: true }))[0]!;
			const transcript = await kernel.sessions.transcript(session.id, { limit: 10000 });
			const calls = transcript.flatMap((e) => e.tools ?? []);
			store = new Store(join(home, ".yonder/plugins/clipboard"), { maxBytes: 262144, ttlSeconds: 3600 });
			const openClips = (await store.all()).filter(
				(item) => item.class === "open" && item.source.type === "message" && item.source.ref === original.id,
			);
			expect(openClips).toHaveLength(1);
			const clipboardCalls = calls.filter((call) => call.name.startsWith("clipboard_"));
			expect(clipboardCalls.map((call) => call.name).sort()).toEqual(["clipboard_copy", "clipboard_paste"]);
			const copyArgs = clipboardCalls.find((call) => call.name === "clipboard_copy")!.args;
			expect([
				{ from: { kind: "message", eventId: original.id } },
				{ from: { kind: "message", eventId: original.id }, class: "open" },
			]).toContainEqual(copyArgs);
			expect(clipboardCalls.find((call) => call.name === "clipboard_paste")!.args).toEqual({
				handle: openClips[0]!.id,
				to: { kind: "file", path: output },
			});
			for (const call of calls) {
				expect(containsBodyFragment(JSON.stringify(call.args), payload)).toBe(false);
			}
			// Trusted capture fixture uses actual Keychain. The value never enters any model input.
			await store.ensure();
			await store.kernel.prepare(AbortSignal.timeout(60000));
			const secret = randomBytes(48).toString("hex"),
				bytes = Buffer.from(secret);
			try {
				clip = await store.save(
					bytes,
					"sealed",
					{ agent: "main", profile: "owner", session: session.id },
					{ type: "test", ref: "generated-never-submitted" },
					AbortSignal.timeout(60000),
				);
			} finally {
				bytes.fill(0);
			}
			client.socket.destroy();
			await kernel.close();
			kernel = await openKernel(home, {
				log: (...args) => {
					logs.push(args);
				},
			});
			client = await connect();
			const sealedFile = join(home, "sealed.txt");
			await submit(
				client,
				`Paste clipboard handle ${clip.id} to file ${sealedFile}, then call read on that file. Its contents are sealed: use only the masked read tool result in a message_send to conv:cli:local, then reply DONE. Never try another reader or shell.`,
			);
			expect((await readFile(sealedFile, "utf8")) === secret).toBe(true);
			const after = await kernel.sessions.transcript(session.id, { limit: 10000 }),
				serialized = JSON.stringify(after),
				ledger = (await kernel.events.query({ limit: 1000 })).events;
			expect(after.flatMap((e) => e.tools ?? []).some((t) => t.name === "read")).toBe(true);
			const allCalls = after.flatMap((e) => e.tools ?? []),
				allClipboardCalls = allCalls.filter((call) => call.name.startsWith("clipboard_"));
			expect(allClipboardCalls.map((call) => call.name).sort()).toEqual([
				"clipboard_copy",
				"clipboard_paste",
				"clipboard_paste",
			]);
			expect(allClipboardCalls.filter((call) => call.name === "clipboard_paste").map((call) => call.args)).toEqual([
				{ handle: openClips[0]!.id, to: { kind: "file", path: output } },
				{ handle: clip!.id, to: { kind: "file", path: sealedFile } },
			]);
			for (const call of allCalls) expect(containsBodyFragment(JSON.stringify(call.args), payload)).toBe(false);
			expect(serialized).toContain("[sealed]");
			for (const text of [serialized, JSON.stringify(ledger), JSON.stringify(logs), JSON.stringify(client.packets)])
				expect(text.includes(secret)).toBe(false);
			// logs captures only openKernel's supplied callback; this is not a process/OS/external-log audit.
			const evidence = JSON.stringify({
				check: "clipboard-luna",
				model: "openai/gpt-6-luna",
				sourceChars: payload.length,
				sourceBytes: Buffer.byteLength(payload),
				toolCalls: after.flatMap((e) => e.tools ?? []).length,
				byteExact: true,
				sealedAbsent: true,
				restart: true,
			});
			await writeFile(process.env.YONDER_CLIP_TEST_REPORT ?? join(home, "report.json"), evidence);
		} finally {
			for (const socket of sockets) socket.destroy();
			await kernel?.close();
			if (clip && store) await store.drop(clip, AbortSignal.timeout(20000));
			await rm(home, { recursive: true, force: true });
		}
	},
	360000,
);
