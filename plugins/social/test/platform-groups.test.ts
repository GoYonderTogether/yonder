import { expect, test } from "vitest";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { groupFixture } from "./group-fixture.js";

test("a platform Bot with no group bindings joins a new room through an isolated default and survives reload", async () => {
	const f = await groupFixture({ membership: true, noBindings: true, captureSocialApi: true });
	let restarted: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		const conv = "conv:qq-main:main:joined-platform-room";
		const unaddressed = await f.probe.ios["qq-main"].emit({
			type: "message.in",
			conv,
			from: "acct:qq-main:owner",
			data: { kind: "group", text: "未确认目标不获默认绑定" },
		});
		expect(unaddressed.routes!.every((r) => !r.session)).toBe(true);
		const source = await f.probe.ios["qq-main"].emit({
			type: "message.in",
			conv,
			from: "acct:qq-main:owner",
			data: {
				kind: "group",
				target: "main",
				mentioned: false,
				text: "检查新群接入",
				social: { room: "platform:joined-room", mentions: { bot: false } },
			},
		});
		const route = source.routes!.find((r) => r.agent === "main")!;
		expect(route).toMatchObject({ binding: "@platform-group:qq-main", wake: "write" });
		const session = await f.kernel.sessions.get(route.session!);
		expect(session).toMatchObject({ profile: "@platform-group:qq-main", mode: "persistent" });
		const decisions = await f.kernel.events.query({ type: "routing.social-decision", after: source.id });
		const decision = decisions.events.find((e) => e.parent === source.id)!;
		expect(decision.data).toMatchObject({ reason: "batch", membership: true });
		expect(f.probe.socialApi).toBeDefined();
		const request = {
			agent: "main",
			conv,
			through: source.id,
			sourceEvents: [source.id],
			policyRevision: (decision.data as { revision: string }).revision,
		};
		expect(await f.probe.socialApi!.social!.admitBatch(request)).toEqual({ session: route.session });
		const batch = await f.probe.socialApi!.events.emit({
			type: "social.batch-ready",
			from: "plugin:social",
			conv,
			data: { ...request, msgId: "platform-default-batch" },
		});
		expect(batch.routes!.find((r) => r.agent === "main")).toMatchObject({
			session: route.session,
			wake: "run",
			binding: "@platform-group:qq-main:batch",
		});
		await f.kernel.sessions.abort(route.session!);
		// Do not invoke a model: this checks the real event/binding admission path only.
		await f.kernel.close();
		restarted = await openKernel(f.home);
		const restored = await restarted.management({ action: "inspect", agent: "main", profile: session!.profile });
		expect(restored).toMatchObject({
			capabilities: ["read"],
			contexts: ["peer-workspace"],
			skills: [],
			plugins: ["social"],
		});
		expect(
			(restored as { tools: Array<{ name: string; exposure: string }> }).tools.find((t) => t.name === "bash"),
		).toMatchObject({ exposure: "capability-denied" });
	} finally {
		await restarted?.close();
		await f.close();
	}
}, 30000);
