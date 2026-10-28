import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelIO, PluginAPI, Tool, ToolContext } from "@yonder/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GithubChannel, marker } from "../src/channel.js";
import { Github } from "../src/client.js";
import plugin from "../src/index.js";
import { Releases } from "../src/releases.js";
import { type Request, verifiedService } from "../src/update-job.js";
import { readUpdate, scheduleUpdate } from "../src/updates.js";

// Protocol-only checks. No model, GitHub request, authorization or launchd action runs here.
const boundary = vi.hoisted(() => ({ copy: vi.fn(), launch: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	execFile: (
		_program: string,
		args: string[],
		_options: unknown,
		callback: (error: Error | null, out?: string, err?: string) => void,
	) => {
		try {
			boundary.launch(args);
			callback(null, "", "");
		} catch (error) {
			callback(error as Error);
		}
	},
}));
vi.mock("node:fs/promises", async (original) => ({
	...(await original<typeof import("node:fs/promises")>()),
	copyFile: (...args: unknown[]) => boundary.copy(...args),
}));
let directory: string;
let api: PluginAPI;
const signal = () => new AbortController().signal;
const release = (id: number, author = "GoYonderTogether", extra = {}) => ({
	id,
	tag_name: "v0.1.4",
	draft: false,
	prerelease: false,
	published_at: "2026-10-18T00:00:00Z",
	author: { login: author },
	html_url: "https://github.com/GoYonderTogether/yonder/releases/tag/v0.1.4",
	...extra,
});
function channel() {
	return new GithubChannel(
		"github-project",
		{
			repository: "GoYonderTogether/yonder",
			accounts: ["GoYonderTogether"],
			labels: ["yonder-task"],
			releases: {
				approvedAuthors: ["GoYonderTogether"],
				policy: "apply",
				updater: { install: "/private/tmp/yonder-install", home: "/private/tmp/yonder-home" },
			},
		},
		api,
	);
}
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "yonder-github-check-"));
	api = {
		paths: { data: directory },
		log: { warn: vi.fn() },
		events: { on: vi.fn() },
		contexts: { register: vi.fn() },
	} as unknown as PluginAPI;
	boundary.copy.mockReset().mockResolvedValue(undefined);
	boundary.launch.mockReset();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe("release baseline", () => {
	it("saves every initial native id, then emits only new approved formal releases across restarts", async () => {
		const client = new Github("GoYonderTogether/yonder");
		const list = vi
			.spyOn(client, "list")
			.mockResolvedValue([release(1), release(2, "other"), release(3, "GoYonderTogether", { draft: true })]);
		const io = { emit: vi.fn().mockResolvedValue({}) } as unknown as ChannelIO;
		const create = () => new Releases("github-project", client.repo, { approvedAuthors: ["GoYonderTogether"] }, api);
		await create().poll(client, io, signal());
		expect(io.emit).not.toHaveBeenCalled();
		expect(JSON.parse(await readFile(join(directory, "github-project.releases.json"), "utf8")).ids).toEqual([
			"1",
			"2",
			"3",
		]);
		list.mockResolvedValue([
			release(1),
			release(2),
			release(3),
			release(4),
			release(5, "other"),
			release(6, "GoYonderTogether", { prerelease: true }),
		]);
		await create().poll(client, io, signal());
		expect(io.emit).toHaveBeenCalledTimes(1);
		expect(vi.mocked(io.emit).mock.calls[0]?.[0].data?.msgId).toBe("release:4:published");
		await create().poll(client, io, signal());
		expect(io.emit).toHaveBeenCalledTimes(1);
	});
	it("does not establish a baseline when polling fails", async () => {
		const client = new Github("GoYonderTogether/yonder");
		const list = vi
			.spyOn(client, "list")
			.mockRejectedValueOnce(new Error("transport failed"))
			.mockResolvedValue([release(1)]);
		const io = { emit: vi.fn() } as unknown as ChannelIO;
		const source = new Releases("github-project", client.repo, { approvedAuthors: ["GoYonderTogether"] }, api);
		await expect(source.poll(client, io, signal())).rejects.toThrow("transport failed");
		await source.poll(client, io, signal());
		expect(list).toHaveBeenCalledTimes(2);
		expect(io.emit).not.toHaveBeenCalled();
	});
	it("does not accept events before baseline persistence succeeds", async () => {
		const client = new Github("GoYonderTogether/yonder");
		vi.spyOn(client, "list").mockResolvedValue([release(1)]);
		const io = { emit: vi.fn() } as unknown as ChannelIO;
		await mkdir(join(directory, "github-project.releases.json.tmp"));
		const source = new Releases("github-project", client.repo, { approvedAuthors: ["GoYonderTogether"] }, api);
		await expect(source.poll(client, io, signal())).rejects.toThrow();
		await rm(join(directory, "github-project.releases.json.tmp"), { recursive: true });
		await source.poll(client, io, signal());
		expect(io.emit).not.toHaveBeenCalled();
	});
});

describe("comments", () => {
	it("uses common delivery with the actual tool context and preserves uncertain receipts", async () => {
		const tools = new Map<string, Tool>();
		let provider: { create(id: string, config: unknown): unknown };
		const send = vi.fn().mockResolvedValue({ ok: false, uncertain: true, error: "response lost" });
		await plugin.setup({
			...api,
			tools: { register: (tool: Tool) => tools.set(tool.name, tool) },
			channels: {
				register: (value: typeof provider) => {
					provider = value;
				},
			},
			messages: { send },
		} as unknown as PluginAPI);
		provider!.create("github-project", channel().config);
		const ctx = { signal: signal(), sessionId: "session-check", eventId: "event-check" } as unknown as ToolContext;
		const result = await tools
			.get("channel-github_comment")!
			.execute({ instance: "github-project", issue: 1, body: "status" }, ctx);
		expect(send).toHaveBeenCalledWith(
			{
				to: "conv:github-project:GoYonderTogether/yonder:issue:1",
				via: "github-project",
				text: "status",
				signal: ctx.signal,
			},
			ctx,
		);
		expect(JSON.parse(result.text).result).toEqual({ ok: false, uncertain: true, error: "response lost" });
	});
	it("adds the self-loop marker to every ordinary channel comment and returns its native id", async () => {
		const c = channel();
		vi.spyOn(c.client, "get").mockResolvedValue({ labels: [{ name: "yonder-task" }] });
		const write = vi.spyOn(c.client, "write").mockResolvedValue({ id: 42 });
		expect(await c.send(c.conv(1), { text: "status" })).toEqual({ ok: true, id: "42" });
		expect(write.mock.calls[0]?.[1]).toEqual({ body: `status\n\n${marker}` });
	});
	it("rejects PRs, missing labels and foreign targets before writing", async () => {
		const c = channel();
		const get = vi
			.spyOn(c.client, "get")
			.mockResolvedValueOnce({ pull_request: {}, labels: ["yonder-task"] })
			.mockResolvedValueOnce({ labels: [] });
		const write = vi.spyOn(c.client, "write");
		for (const target of [c.conv(1), c.conv(2), "conv:other:issue:1"])
			expect((await c.send(target, { text: "status" })).ok).toBe(false);
		expect(get).toHaveBeenCalledTimes(2);
		expect(write).not.toHaveBeenCalled();
	});
	it("marks a lost POST response uncertain without retrying", async () => {
		const c = channel();
		vi.spyOn(c.client, "get").mockResolvedValue({ labels: ["yonder-task"] });
		const write = vi.spyOn(c.client, "write").mockRejectedValue(new Error("connection closed"));
		expect(await c.send(c.conv(1), { text: "status" })).toMatchObject({ ok: false, uncertain: true });
		expect(write).toHaveBeenCalledTimes(1);
	});
});

// Service-external update dispatch uses the macOS launchd user domain.
describe.skipIf(process.platform !== "darwin")("update dispatch ownership", () => {
	it("cleans failed preparation and permits another release without ever invoking bootstrap", async () => {
		boundary.copy.mockRejectedValue(new Error("runner copy failed"));
		await expect(scheduleUpdate(api, channel(), release(1), signal())).rejects.toThrow("runner copy failed");
		expect(await readdir(join(directory, "github-project.updates"))).toEqual([]);
		await expect(scheduleUpdate(api, channel(), release(2), signal())).rejects.toThrow("runner copy failed");
		expect(boundary.launch).not.toHaveBeenCalled();
	});
	it("cleans cancellation before dispatch; no unknown mutation occurred", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(scheduleUpdate(api, channel(), release(1), controller.signal)).rejects.toThrow();
		expect(await readdir(join(directory, "github-project.updates"))).toEqual([]);
		expect(boundary.launch).not.toHaveBeenCalled();
	});
	it("preserves uncertain bootstrap, reports missing result and never resubmits", async () => {
		boundary.launch.mockImplementation((args) => {
			if (args[0] === "bootstrap") throw new Error("dispatch response lost");
			if (args[0] === "print") throw new Error("job absent");
		});
		await expect(scheduleUpdate(api, channel(), release(1), signal())).rejects.toThrow("uncertain");
		const first = await readUpdate(api, "github-project", "1", signal());
		expect(first).toMatchObject({ result: null, status: "not-running-outcome-unknown" });
		await scheduleUpdate(api, channel(), release(1), signal());
		await expect(scheduleUpdate(api, channel(), release(2), signal())).rejects.toThrow("no terminal receipt");
		expect(boundary.launch.mock.calls.filter(([args]) => args[0] === "bootstrap")).toHaveLength(1);
	});
});

it("rejects service-external updates outside macOS before dispatch", async () => {
	vi.spyOn(process, "platform", "get").mockReturnValue("linux");
	await expect(scheduleUpdate(api, channel(), release(1), signal())).rejects.toThrow(
		"Service-external updates require macOS launchd user domain",
	);
	expect(boundary.copy).not.toHaveBeenCalled();
	expect(boundary.launch).not.toHaveBeenCalled();
});

describe("actual service evidence", () => {
	const request = {
		install: "/private/tmp/yonder-install",
		home: "/private/tmp/yonder-home",
		repository: "GoYonderTogether/yonder",
		tag: "v0.1.4",
		version: "0.1.4",
	} as Request;
	const commit = "ae60bf2".padEnd(40, "0");
	const actual = {
		source: `${request.install}/versions/0.1.4`,
		install: request.install,
		version: request.version,
		origin: { tag: request.tag, repository: `https://github.com/${request.repository}.git`, commit },
	};
	const service = { loaded: true, pid: 123, home: request.home, install: request.install };
	const running = { pid: 123, home: request.home, ready: true, version: request.version, commit };
	it("accepts matched disk origin and ready service self-report", () =>
		expect(verifiedService(request, actual, service, running)).toBe(true));
	it.each([{ ready: false }, { version: "0.1.3" }, { commit: "0".repeat(40) }, { pid: 124 }, { home: "/other" }])(
		"rejects running evidence mismatch %j",
		(difference) => expect(verifiedService(request, actual, service, { ...running, ...difference })).toBe(false),
	);
	it("rejects disk source outside the configured installation", () =>
		expect(verifiedService(request, { ...actual, source: "/source-checkout" }, service, running)).toBe(false));
	it("accepts a receipt recorded under the previous repository name", () =>
		expect(
			verifiedService(
				request,
				{
					...actual,
					origin: { ...actual.origin, repository: "https://github.com/GoYonderTogether/yonder-harness.git" },
				},
				service,
				running,
			),
		).toBe(true));
});

describe("issue source protocol", () => {
	it("uses all REST pages including a full page boundary", async () => {
		const client = new Github("GoYonderTogether/yonder");
		const get = vi
			.spyOn(client, "get")
			.mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })))
			.mockResolvedValueOnce([{ id: 101 }]);
		expect(await client.list("issues?state=all", signal())).toHaveLength(101);
		expect(get.mock.calls.map(([path]) => path)).toEqual([
			"repos/GoYonderTogether/yonder/issues?state=all&per_page=100&page=1",
			"repos/GoYonderTogether/yonder/issues?state=all&per_page=100&page=2",
		]);
	});
	it("persists native ids across restart, retaining the inclusive same-second boundary and admission filters", async () => {
		const io = { emit: vi.fn().mockResolvedValue({}) } as unknown as ChannelIO;
		const issue = {
			id: 1,
			number: 1,
			updated_at: "2026-10-18T00:00:00Z",
			labels: ["yonder-task"],
			user: { login: "GoYonderTogether" },
			body: "task",
		};
		let includeNew = false;
		const paths: string[] = [];
		const run = async () => {
			const c = new GithubChannel(
				"github-project",
				{ repository: "GoYonderTogether/yonder", labels: ["yonder-task"], accounts: ["GoYonderTogether"] },
				api,
			);
			vi.spyOn(c.client, "get").mockImplementation(async (path) => {
				paths.push(path);
				const issueNumber = Number(/issues\/(\d+)\/comments/.exec(path)?.[1] ?? 0);
				if (path === "user") return { login: "GoYonderTogether" };
				if (path.includes("/comments?"))
					return [
						{ id: issueNumber * 100 + 10, user: { login: "GoYonderTogether" }, body: `status ${marker}` },
						{ id: issueNumber * 100 + 11, user: { login: "other" }, body: "not admitted" },
						{ id: issueNumber * 100 + 12, user: { login: "GoYonderTogether" }, body: "follow up" },
					];
				return [
					issue,
					{ ...issue, id: 2, number: 2, labels: [] },
					{ ...issue, id: 3, number: 3, pull_request: {} },
					{ ...issue, id: 4, number: 4, user: { login: "other" } },
					...(includeNew ? [{ ...issue, id: 5, number: 5 }] : []),
				];
			});
			await c.start(io);
			await vi.waitFor(() => expect(c.state).toBe("ready"));
			await c.stop();
		};
		await run();
		expect(paths.find((path) => path.includes("/issues?"))).not.toContain("since=");
		expect(vi.mocked(io.emit).mock.calls.map(([event]) => event.data?.msgId)).toEqual([
			"issue:1",
			"comment:112",
			"comment:412",
		]);
		// Admitted commenters may reply to an issue originally opened by another account.
		includeNew = true;
		await run();
		expect(vi.mocked(io.emit).mock.calls.map(([event]) => event.data?.msgId)).toEqual([
			"issue:1",
			"comment:112",
			"comment:412",
			"issue:5",
			"comment:512",
		]);
		expect(paths.some((path) => path.includes("since=2026-10-17T23%3A59%3A59.000Z"))).toBe(true);
		const state = JSON.parse(await readFile(join(directory, "github-project.json"), "utf8"));
		expect(state.issues["1"]).toEqual({ emitted: true, comment: "112" });
		expect(state.issues["4"]).toEqual({ emitted: false, comment: "412" });
	});
	it("keeps omitted PR patches and pending checks explicit", async () => {
		const tools = new Map<string, Tool>();
		let provider: { create(id: string, config: unknown): unknown };
		await plugin.setup({
			...api,
			tools: { register: (tool: Tool) => tools.set(tool.name, tool) },
			channels: {
				register: (value: typeof provider) => {
					provider = value;
				},
			},
		} as unknown as PluginAPI);
		const c = provider!.create("github-project", channel().config) as GithubChannel;
		const sha = "a".repeat(40);
		vi.spyOn(c.client, "get")
			.mockResolvedValueOnce({ head: { sha } })
			.mockResolvedValueOnce({ check_runs: [{ status: "in_progress", conclusion: null }] });
		vi.spyOn(c.client, "list")
			.mockResolvedValueOnce([{ filename: "binary.png" }, { filename: "text.ts", patch: "+line" }])
			.mockResolvedValueOnce([{ sha }])
			.mockResolvedValueOnce([{ state: "pending" }]);
		const result = await tools
			.get("channel-github_read_pr")!
			.execute({ instance: "github-project", pr: 1 }, { signal: signal() } as ToolContext);
		const facts = JSON.parse(result.text).result;
		expect(facts.files.map((file: { patchOmitted: boolean }) => file.patchOmitted)).toEqual([true, false]);
		expect(facts.checks).toEqual([{ status: "in_progress", conclusion: null }]);
		expect(facts.statuses).toEqual([{ state: "pending" }]);
	});
});
