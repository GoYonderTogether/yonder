import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, YEvent } from "@yonder/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuApi } from "../src/client.js";
import { FeishuInteraction } from "../src/interaction.js";

const homes: string[] = [];
afterEach(async () => {
	await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function setup() {
	const home = await mkdtemp(join(tmpdir(), "feishu-interaction-"));
	homes.push(home);
	const api = { paths: { data: home }, log: { warn: vi.fn() } } as unknown as PluginAPI;
	const client = new FeishuApi({ appId: "test", secret: "unused" }, api);
	const request = vi
		.spyOn(client, "request")
		.mockImplementation(async (_path, method) =>
			method === "POST" ? { data: { reaction_id: "reaction-own" } } : { code: 0 },
		);
	const interaction = new FeishuInteraction("feishu", client, api);
	await interaction.start();
	return { home, api, client, request, interaction };
}
function input(id: string, data: object = { msgId: id }, runnable = true): YEvent {
	return {
		id,
		ts: new Date().toISOString(),
		type: "message.in",
		conv: "conv:feishu:chat",
		data,
		routes: [{ agent: "owner", binding: "dm", wake: runnable ? "run" : "write" }],
	};
}
it("marks runnable native inputs, clears before reply, and quotes only after another user bubble", async () => {
	const { interaction, request } = await setup();
	await interaction.onInput(input("m1"));
	expect(request).toHaveBeenCalledWith("/im/v1/messages/m1/reactions", "POST", {
		reaction_type: { emoji_type: "Typing" },
	});
	expect(await interaction.beforeReply("conv:feishu:chat", "m1")).toBeUndefined();
	expect(request).toHaveBeenLastCalledWith("/im/v1/messages/m1/reactions/reaction-own", "DELETE");
	await interaction.onInput(input("m2", { msgId: "m2" }, false));
	expect(await interaction.beforeReply("conv:feishu:chat", "m1")).toBe("m1");
	expect(await interaction.beforeReply("conv:feishu:chat", "m1", "explicit")).toBe("explicit");
	expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
});
it("marks recovery originals individually and clears NO_REPLY terminal inputs", async () => {
	const { interaction, request } = await setup();
	await interaction.onInput(input("recovery-hash", { originals: [{ messageId: "m1" }, { msgId: "m2" }] }));
	expect(request.mock.calls.filter((call) => call[1] === "POST").map((call) => call[0])).toEqual([
		"/im/v1/messages/m1/reactions",
		"/im/v1/messages/m2/reactions",
	]);
	await interaction.onEnd({
		id: "end",
		ts: "",
		type: "run.end",
		data: { inputs: ["recovery-hash"], replied: "none", status: "aborted" },
	});
	expect(request.mock.calls.filter((call) => call[1] === "DELETE")).toHaveLength(2);
});
it("clears an add that resolves after reply preparation without duplicate deletes", async () => {
	const { interaction, request } = await setup();
	let resolve!: (value: object) => void;
	request.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const adding = interaction.onInput(input("pending"));
	const replying = interaction.beforeReply("conv:feishu:chat", "pending");
	const ending = interaction.onEnd({ id: "end", ts: "", type: "channel.command.result", parent: "pending", data: {} });
	resolve({ data: { reaction_id: "later" } });
	await Promise.all([adding, replying, ending]);
	expect(request.mock.calls.filter((call) => call[1] === "DELETE")).toHaveLength(1);
});
it("persists confirmed own reaction IDs and cleans those receipts on restart", async () => {
	const { interaction, request, home, client, api } = await setup();
	await interaction.onInput(input("m1"));
	expect(JSON.parse(await readFile(join(home, "feishu", "reactions.json"), "utf8"))).toEqual([
		{ chat: "conv:feishu:chat", messageId: "m1", eventId: "m1", reactionId: "reaction-own" },
	]);
	request.mockClear();
	const restarted = new FeishuInteraction("feishu", client, api);
	await restarted.start();
	expect(request).toHaveBeenCalledExactlyOnceWith("/im/v1/messages/m1/reactions/reaction-own", "DELETE");
	expect(JSON.parse(await readFile(join(home, "feishu", "reactions.json"), "utf8"))).toEqual([]);
});
it("isolates other instances and dropped routes; platform failures are logged once", async () => {
	const { interaction, request, api } = await setup();
	await interaction.onInput({ ...input("other"), conv: "conv:other:chat" });
	await interaction.onInput({
		...input("dropped"),
		routes: [{ agent: "owner", binding: null, wake: "run", dropped: "no-binding" }],
	});
	expect(request).not.toHaveBeenCalled();
	request.mockRejectedValueOnce(new Error("platform unavailable"));
	await interaction.onInput(input("failure"));
	await interaction.stop();
	expect(request).toHaveBeenCalledTimes(1);
	expect(api.log.warn).toHaveBeenCalledWith(
		"Feishu reaction unavailable",
		expect.objectContaining({ phase: "add", error: "platform unavailable" }),
	);
});

it("keeps failed cleanup receipts for the next startup without retrying an unknown DELETE", async () => {
	const { interaction, request, home, api } = await setup();
	await interaction.onInput(input("m1"));
	request.mockRejectedValueOnce(new Error("delete receipt unavailable"));
	await interaction.beforeReply("conv:feishu:chat", "m1");
	await interaction.stop();
	expect(request.mock.calls.filter((call) => call[1] === "DELETE")).toHaveLength(1);
	expect(JSON.parse(await readFile(join(home, "feishu", "reactions.json"), "utf8"))).toHaveLength(1);
	expect(api.log.warn).toHaveBeenCalledWith(
		"Feishu reaction unavailable",
		expect.objectContaining({ phase: "remove" }),
	);
});
it("reports persistence failure and still removes a confirmed remote reaction", async () => {
	const { interaction, request, home, api } = await setup();
	await writeFile(join(home, "feishu"), "occupied");
	await interaction.onInput(input("m1"));
	await interaction.beforeReply("conv:feishu:chat", "m1");
	expect(request).toHaveBeenLastCalledWith("/im/v1/messages/m1/reactions/reaction-own", "DELETE");
	expect(api.log.warn).toHaveBeenCalledWith("Feishu reaction unavailable", expect.objectContaining({ phase: "add" }));
	expect(api.log.warn).toHaveBeenCalledWith(
		"Feishu reaction unavailable",
		expect.objectContaining({ phase: "remove" }),
	);
});
