import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import {
	createRegistry,
	defineExtension,
	Harness,
	LiveDoc,
	RunReceiptDoc,
	watchEvents,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import { expect, test } from "vitest";
import { openDatabase } from "./db.js";
import { FileCredentials } from "./index.js";
import { buildModels } from "./models.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");

// Bare pi Harness: no Yonder Runtime.beforeAgent, configuration snapshot, or product RunDoc proof.

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna native submission recovery evidence: dedup, steer/followup, and queued abort",
	async () => {
		const home = await mkdtemp("/tmp/yonder-recovery-probe-");
		let db = await openDatabase(`${home}/state.db`);
		const registry = createRegistry();
		const coding = defineExtension({ ...createCodingTools(), name: "probe.coding" });
		registry.install(coding);
		const models = buildModels(new FileCredentials(auth));
		const openHarness = async () => {
			const storage = await SqliteStorage.open(db, { prefix: "pi_" });
			const harness = await Harness.open(
				storage,
				{
					models,
					onReport: (error) => console.error(error),
					registry,
					env: ({ cwd }) => (cwd ? new NodeExecutionEnv({ cwd }) : undefined),
				},
				C,
			);
			return { storage, harness };
		};
		let opened = await openHarness();
		let watcher: Awaited<ReturnType<typeof watchEvents>> | undefined;
		try {
			const harness = opened.harness;
			const bash = coding.tools?.find((tool) => tool.name === "bash");
			if (!bash) throw new Error("pi coding tools lack bash");
			const conversation = await harness.createConversation(
				{
					ownership: { kind: "ownerless" },
					agent: {
						model: { provider: "openai", modelId: "gpt-6-luna" },
						thinkingLevel: "off",
						extensions: [coding],
						tools: [bash],
						modelTools: [bash],
						instructions: "Follow user instructions exactly. Use tools only when requested.",
						cwd: home,
					},
				},
				C,
			);
			watcher = await watchEvents(harness, conversation.id, C);
			let bashStarted = false;
			const runEnds: number[][] = [];
			watcher.start(async (events) => {
				if (events.some((event) => event.type === "tool_execution_start" && event.toolName === "bash"))
					bashStarted = true;
				for (const event of events) if (event.type === "run_end") runEnds.push([...event.inputs]);
			});
			const a = await conversation.submit(
				{
					type: "input",
					requestId: "event-A",
					whenBusy: "followUp",
					content:
						"Call bash exactly once with command `sleep 8; printf gate-A`. After it finishes, reply `A complete`.",
				},
				C,
			);
			const aWait = a.wait(C);
			await expect.poll(() => bashStarted, { timeout: 45000 }).toBe(true);
			const c = await conversation.submit(
				{ type: "input", requestId: "event-C", whenBusy: "followUp", content: "Reply exactly `C complete`." },
				C,
			);
			const b = await conversation.submit(
				{ type: "input", requestId: "event-B", whenBusy: "steer", content: "Reply exactly `B complete`." },
				C,
			);
			const withdrawn = await conversation.submit(
				{ type: "input", requestId: "event-withdrawn", content: "This queued input will be explicitly withdrawn." },
				C,
			);
			expect((await a.status(C)).status).toBe("placed");
			expect((await c.status(C)).status).toBe("queued");
			expect((await b.status(C)).status).toBe("queued");
			expect(await withdrawn.abort(C)).toBe("aborted");
			const running = await harness.snapshot(LiveDoc, conversation.id, C);
			expect(running?.run?.inputs).toContain(a.id);
			const inspectBefore = await harness.inspect(C);
			expect(inspectBefore.scheduling).toBe("running");
			const [aResult, bResult, cResult] = await Promise.all([aWait, b.wait(C), c.wait(C)]);
			expect(aResult.status).toBe("done");
			expect(bResult.status).toBe("done");
			expect(cResult.status).toBe("done");
			const aRecord = await opened.storage.submission(a.id, C);
			const bRecord = await opened.storage.submission(b.id, C);
			const cRecord = await opened.storage.submission(c.id, C);
			expect(aRecord?.status).toBe("done");
			expect(bRecord?.status).toBe("done");
			expect(cRecord?.status).toBe("done");
			const groups = new Map<string, number[]>();
			for (const record of [aRecord, bRecord, cRecord]) {
				if (record?.type !== "input" || record.status !== "done") throw new Error("Expected settled input record");
				const ids = groups.get(String(record.answer)) ?? [];
				ids.push(record.id);
				groups.set(String(record.answer), ids);
			}
			const answerGroups = [...groups.values()];
			expect(answerGroups.some((ids) => ids.includes(a.id) && ids.includes(b.id))).toBe(true);
			expect(answerGroups.some((ids) => ids.includes(c.id) && !ids.includes(a.id) && !ids.includes(b.id))).toBe(true);
			expect(runEnds).toContainEqual(expect.arrayContaining([a.id, b.id]));
			expect(runEnds.some((inputs) => inputs.includes(c.id) && !inputs.includes(a.id) && !inputs.includes(b.id))).toBe(
				true,
			);
			const withdrawnBefore = await opened.storage.submission(withdrawn.id, C);
			expect(withdrawnBefore).toMatchObject({ status: "unanswered", reason: "aborted", requestId: "event-withdrawn" });
			const byRequest = await conversation.commit((tx) => tx.submissionByRequest(conversation.id, "event-A"), C);
			expect(byRequest?.id).toBe(a.id);
			const donePage = await opened.storage.scanSubmissions(
				{ conversationId: conversation.id, status: "done", order: "ascending" },
				2,
				undefined,
				C,
			);
			expect(donePage.items.length).toBe(2);
			expect(donePage.next).toBeDefined();
			const usage = await harness.snapshot((await import("@earendil-works/pi-durable")).UsageDoc, conversation.id, C);
			console.log(
				JSON.stringify({
					scenario: "native-run-membership",
					a: a.id,
					b: b.id,
					c: c.id,
					runEnds,
					answerGroups,
					piUsage: usage,
				}),
			);

			await watcher.stop();
			watcher = undefined;
			await harness.close(C);
			await db.close();
			db = await openDatabase(`${home}/state.db`);
			opened = await openHarness();
			const reopened = opened.harness;
			const state = await reopened.inspect(C);
			expect(state.scheduling).toBe("paused");
			const reopenedConversation = await reopened.conversation(conversation.id, C);
			if (!reopenedConversation) throw new Error("Conversation missing after reopen");
			const recovered = await Promise.all(
				["event-A", "event-B", "event-C", "event-withdrawn"].map((requestId) =>
					reopenedConversation.commit((tx) => tx.submissionByRequest(conversation.id, requestId), C),
				),
			);
			expect(recovered.map((record) => record?.requestId)).toEqual([
				"event-A",
				"event-B",
				"event-C",
				"event-withdrawn",
			]);
			expect(recovered[3]).toMatchObject({ status: "unanswered", reason: "aborted" });
			expect((await reopened.inspect(C)).scheduling).toBe("paused");
			const duplicate = await reopenedConversation.submit(
				{ type: "input", requestId: "event-A", content: "MUST NOT BE ADMITTED AGAIN." },
				C,
			);
			expect(duplicate.id).toBe(a.id);
			expect((await duplicate.status(C)).status).toBe("done");
			expect((await opened.storage.submission(duplicate.id, C))?.id).toBe(a.id);
			expect((await reopened.inspect(C)).scheduling).toBe("running");
			const pageAfterReopen = await opened.storage.scanSubmissions(
				{ conversationId: conversation.id, status: "done", order: "ascending" },
				2,
				undefined,
				C,
			);
			expect(pageAfterReopen.items).toHaveLength(2);
			expect(pageAfterReopen.next).toBeDefined();
			console.log(
				JSON.stringify({
					scenario: "reopen-read-and-idempotent-submit",
					schedulerAfterReads: "paused-before-submit",
					schedulerAfterDuplicateSubmit: (await reopened.inspect(C)).scheduling,
					recovered: recovered.map((record) => ({
						id: record?.id,
						status: record?.status,
						reason: record?.status === "unanswered" ? record.reason : undefined,
					})),
				}),
			);
		} finally {
			try {
				await watcher?.stop();
			} finally {
				try {
					await opened.harness.close(C);
				} finally {
					try {
						await db.close();
					} finally {
						await rm(home, { recursive: true, force: true });
					}
				}
			}
		}
	},
	240000,
);

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna unanswered group persistence and successor evidence",
	async () => {
		const home = await mkdtemp("/tmp/yonder-unanswered-probe-");
		let db = await openDatabase(`${home}/state.db`);
		const registry = createRegistry();
		const coding = defineExtension({ ...createCodingTools(), name: "probe.coding" });
		registry.install(coding);
		const models = buildModels(new FileCredentials(auth));
		const open = async () => {
			const storage = await SqliteStorage.open(db, { prefix: "pi_" });
			const harness = await Harness.open(
				storage,
				{
					models,
					onReport: (error) => console.error(error),
					registry,
					env: ({ cwd }) => (cwd ? new NodeExecutionEnv({ cwd }) : undefined),
				},
				C,
			);
			return { storage, harness };
		};
		let opened = await open();
		let watcher: Awaited<ReturnType<typeof watchEvents>> | undefined;
		try {
			const bash = coding.tools?.find((tool) => tool.name === "bash");
			if (!bash) throw new Error("pi coding tools lack bash");
			const conversation = await opened.harness.createConversation(
				{
					ownership: { kind: "ownerless" },
					agent: {
						model: { provider: "openai", modelId: "gpt-6-luna" },
						thinkingLevel: "off",
						extensions: [coding],
						tools: [bash],
						modelTools: [bash],
						cwd: home,
						instructions: "Follow the user's tool instructions exactly.",
					},
				},
				C,
			);
			const atomicReceipts: number[][] = [];

			opened.harness.subscribeCommits((publication) => {
				for (const change of publication.changes) {
					if (change.type === "document" && change.record.kind === "pi.run-receipt" && change.value) {
						const ids = change.value.inputs as number[];
						const settled: number[] = publication.changes
							.filter((c) => c.type === "submission" && (c.value.status === "done" || c.value.status === "unanswered"))
							.map((c) => (c.type === "submission" ? c.value.id : 0));
						if (!ids.every((id) => settled.includes(id))) throw new Error("Receipt is not atomic with settlements");
						atomicReceipts.push([...ids]);
					}
				}
			});
			let toolStarted = false;
			const runEnds: number[][] = [];
			watcher = await watchEvents(opened.harness, conversation.id, C);
			watcher.start(async (events) => {
				for (const event of events) {
					if (event.type === "tool_execution_start") toolStarted = true;
					if (event.type === "run_end") runEnds.push([...event.inputs]);
				}
			});
			const a = await conversation.submit(
				{
					type: "input",
					requestId: "abort-A",
					content:
						"Call bash with `sleep 5; printf first-gate`. After that call finishes, call bash again with `sleep 30; printf second-gate`. Only then reply done.",
				},
				C,
			);
			await expect.poll(() => toolStarted, { timeout: 45000 }).toBe(true);
			const c = await conversation.submit(
				{ type: "input", requestId: "abort-C", whenBusy: "followUp", content: "Reply exactly successor." },
				C,
			);
			const b = await conversation.submit(
				{
					type: "input",
					requestId: "abort-B",
					whenBusy: "steer",
					content: "Continue A's requested second bash call before replying.",
				},
				C,
			);
			await expect.poll(async () => (await b.status(C)).status, { timeout: 45000 }).toBe("placed");
			const live = await opened.harness.snapshot(LiveDoc, conversation.id, C);
			expect(live?.run?.inputs).toEqual([a.id, b.id]);
			if (!live?.run) throw new Error("Missing run to abort");
			await opened.harness.abortTask(live.run.taskId, C);
			// abortTask joins the run invocation, not necessarily the later abort handler.
			await a.wait(C);
			const ended = await opened.harness.snapshot(RunReceiptDoc, conversation.id, String(a.id), C);
			expect(ended?.inputs).toEqual([a.id, b.id]);
			expect(ended?.settlement).toMatchObject({ status: "unanswered", reason: "aborted" });
			const receipts = await Promise.all([a.wait(C), b.wait(C), c.wait(C)]);
			expect(await opened.harness.snapshot(RunReceiptDoc, conversation.id, String(a.id), C)).toEqual(ended);
			expect(atomicReceipts).toContainEqual([a.id, b.id]);
			expect(atomicReceipts).toContainEqual([c.id]);
			expect(receipts[0]).toMatchObject({ status: "unanswered", reason: "aborted" });
			expect(receipts[1]).toMatchObject({ status: "unanswered", reason: "aborted" });
			expect(receipts[2].status).toBe("done");
			await expect.poll(() => runEnds).toContainEqual([a.id, b.id]);
			await watcher.stop();
			watcher = undefined;
			await opened.harness.close(C);
			await db.close();
			db = await openDatabase(`${home}/state.db`);
			opened = await open();
			expect(await opened.harness.snapshot(RunReceiptDoc, conversation.id, String(a.id), C)).toEqual(ended);
			const successor = await opened.harness.snapshot(RunReceiptDoc, conversation.id, String(c.id), C);
			expect(successor?.inputs).toEqual([c.id]);
			expect(successor?.settlement?.status).toBe("done");
			expect(successor?.usage).not.toEqual(ended?.usage);
			const recovered = await Promise.all([a.id, b.id, c.id].map((id) => opened.storage.submission(id, C)));
			expect(recovered).toEqual(receipts);
			expect((await opened.harness.snapshot(LiveDoc, conversation.id, C))?.run).toBeUndefined();
			const entries = await opened.storage.scanEntries(
				{ conversationId: conversation.id, order: "ascending" },
				100,
				undefined,
				C,
			);
			const tasks = await opened.storage.scanTasks({ conversationId: conversation.id }, 100, undefined, C);
			expect((await opened.harness.inspect(C)).scheduling).toBe("paused");
			console.log(
				JSON.stringify({
					scenario: "unanswered-public-persistence",
					runEnds,
					recovered,
					entries: entries.items.map((e) => ({ id: e.id, kind: e.kind, byTaskId: e.byTaskId })),
					tasks: tasks.items.map((t) => ({ id: t.id, kind: t.kind, input: t.input, state: t.state })),
				}),
			);
		} finally {
			try {
				await watcher?.stop();
			} finally {
				try {
					await opened.harness.close(C);
				} finally {
					try {
						await db.close();
					} finally {
						await rm(home, { recursive: true, force: true });
					}
				}
			}
		}
	},
	180000,
);

test.each(["no_model", "faulted"])("native %s terminal receipt uses the common boundary", async (reason) => {
	const db = await openDatabase(":memory:");
	const storage = await SqliteStorage.open(db, { prefix: "pi_" });
	const harness = await Harness.open(
		storage,
		{
			models: buildModels(new FileCredentials(auth)),
			registry: createRegistry(),
			...(reason === "faulted"
				? {
						beforeAgent: () => {
							throw new Error("N05 deliberate host configuration fault");
						},
					}
				: {}),
		},
		C,
	);
	try {
		const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, C);
		const submission = await conversation.submit(
			{ type: "input", content: "No model has been configured for this conversation." },
			C,
		);
		expect(await submission.wait(C)).toMatchObject({ status: "unanswered", reason });
		expect(await harness.snapshot(RunReceiptDoc, conversation.id, String(submission.id), C)).toMatchObject({
			inputs: [submission.id],
			settlement: { status: "unanswered", reason },
		});
	} finally {
		await harness.close(C);
	}
});
