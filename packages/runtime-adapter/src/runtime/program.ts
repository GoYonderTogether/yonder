import { type Context, copyJson, type JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import type { ToolCall } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import {
	type ConversationId,
	defineDocFamily,
	type TaskId,
	ToolTask,
	type ToolTaskInput,
	type ToolTaskResult,
} from "@earendil-works/pi-durable";
import type { Tool, ToolResult, YEvent } from "@yonder/sdk";
import { SessionDoc } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import { fromResult } from "./results.js";
import type { RuntimeSessionConfig } from "./types.js";

type ProgramConversationState = { conversationId: number | null };
type ProgramInvocationState = { taskId: number | null; fingerprint: string; tool: string };
type ProgramSnapshotState = { config: string; events: string; allowedTools: string[]; runId: string | null };

const ProgramConversationDoc = defineDocFamily<ProgramConversationState, null>({
	kind: "yonder.program.conversation",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "current",
	family: true,
	initial: () => ({ conversationId: null }),
});
const ProgramInvocationDoc = defineDocFamily<ProgramInvocationState, null>({
	kind: "yonder.program.invocation",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "current",
	family: true,
	initial: () => ({ taskId: null, fingerprint: "", tool: "" }),
});
const ProgramSnapshotDoc = defineDocFamily<ProgramSnapshotState, null>({
	kind: "yonder.program.snapshot",
	version: 1,
	scope: "task",
	family: true,
	initial: () => ({ config: "", events: "[]", allowedTools: [], runId: null }),
});

export type ProgramToolDescriptor = Pick<Tool, "name" | "description" | "parameters"> & {
	plugin?: string;
	exposure: "offer" | "search";
	capabilities: Tool["capabilities"];
	guidelines?: readonly string[];
};

/** Frozen authority and source facts owned by one native program ToolTask. */
export async function programSnapshot(
	rt: RuntimeInternals,
	taskId: TaskId,
	context: Context,
): Promise<{ config: RuntimeSessionConfig; events: YEvent[]; allowedTools: string[]; runId?: string } | undefined> {
	const task = await rt.harness.getTask(taskId, context);
	if (!task) return undefined;
	const snapshot = await rt.harness.snapshot(ProgramSnapshotDoc, taskId, "scope", context);
	if (snapshot?.config) return readProgramSnapshot(snapshot);
	const conversationId = task.conversationId;
	let child = task;
	while (child.owner !== undefined) {
		const input = child.input as unknown as ToolTaskInput;
		if (input.kind !== "nested" || input.parent !== child.owner) return undefined;
		const parent = await rt.harness.getTask(child.owner, context);
		if (!parent || parent.conversationId !== conversationId) return undefined;
		const inherited = await rt.harness.snapshot(ProgramSnapshotDoc, parent.id, "scope", context);
		if (inherited?.config) return readProgramSnapshot(inherited);
		child = parent;
	}
	return undefined;
}

function readProgramSnapshot(snapshot: ProgramSnapshotState) {
	if (!snapshot?.config) return undefined;
	return {
		config: JSON.parse(snapshot.config) as RuntimeSessionConfig,
		events: JSON.parse(snapshot.events) as YEvent[],
		allowedTools: [...snapshot.allowedTools],
		...(snapshot.runId ? { runId: snapshot.runId } : {}),
	};
}

/** Callable tools are precisely those the resolved profile offers or can load through search. */
export function catalogProgramTools(rt: RuntimeInternals, config: RuntimeSessionConfig): ProgramToolDescriptor[] {
	return rt
		.describeTools(config)
		.filter((entry) => entry.exposure === "offer" || entry.exposure === "search")
		.flatMap((entry) => {
			const tool = rt.tools.get(entry.name);
			if (!tool) return [];
			const guidelines = rt.toolGuidelines.get(tool.name);
			return [
				{
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
					exposure: entry.exposure as "offer" | "search",
					...(entry.plugin ? { plugin: entry.plugin } : {}),
					capabilities: [...(rt.capabilities.get(tool.name) ?? [])],
					...(guidelines ? { guidelines: [...guidelines] } : {}),
				},
			];
		});
}

/** Reuse one ownerless Harness conversation for a trusted program scope. */
export async function programConversationId(
	rt: RuntimeInternals,
	scopeKey: string,
	config: RuntimeSessionConfig,
	context: Context = C,
): Promise<ConversationId> {
	const root = await rt.harness.root(context);
	let conversationId: ConversationId | undefined;
	await root.commit(async (tx) => {
		const scope = await tx.doc(ProgramConversationDoc, root.id, scopeKey, null);
		if (scope.conversationId !== null) {
			conversationId = scope.conversationId as ConversationId;
			return;
		}
		const created = await tx.createConversation({ ownership: { kind: "ownerless" } });
		scope.conversationId = created.id;
		conversationId = created.id;
		const session = await tx.doc(SessionDoc, created.id);
		Object.assign(session, {
			agent: config.agent,
			profile: config.profile,
			cwd: config.cwd,
			env: config.resolved.env,
			capabilities: [...config.resolved.capabilities],
			channelInstances: config.resolved.channelInstances ?? null,
		});
	}, context);
	if (conversationId === undefined) throw new Error("Program conversation could not be created");
	return conversationId;
}

/** Execute or retrieve one persistent root ToolTask without creating transcript entries or invoking a model. */
export async function callProgramTool(
	rt: RuntimeInternals,
	request: {
		scope: string;
		invocation: string;
		config: RuntimeSessionConfig;
		tool: string;
		arguments: Record<string, unknown>;
	},
	signal: AbortSignal,
): Promise<ToolResult> {
	const context = withAbortSignal(signal, C);
	if (!request.scope || !request.invocation) return failed("Program scope and invocation are required");
	let args: Record<string, JsonValue>;
	try {
		args = copyJson(request.arguments as JsonValue, { omitUndefinedProperties: true }) as Record<string, JsonValue>;
	} catch (error) {
		return failed(error instanceof Error ? error.message : String(error));
	}
	const fingerprint = canonical({ tool: request.tool, arguments: args });
	const allowed = catalogProgramTools(rt, request.config);
	if (!allowed.some((tool) => tool.name === request.tool)) return failed(`Tool ${request.tool} is not available`);
	const registration = rt.tools.get(request.tool);
	if (!registration) return failed(`Tool ${request.tool} is not available`);
	const call: ToolCall = {
		type: "toolCall",
		id: `program:${request.invocation}`,
		name: request.tool,
		arguments: args,
	};

	let conversationId: ConversationId;
	try {
		conversationId = await programConversationId(rt, request.scope, request.config, context);
	} catch (error) {
		return failed(error instanceof Error ? error.message : String(error));
	}
	const conversation = await rt.harness.conversation(conversationId, context);
	if (!conversation) return failed("Program conversation is missing");
	const config = { ...request.config, sessionId: String(conversation.id) };

	const existing = await rt.harness.snapshot(ProgramInvocationDoc, conversation.id, request.invocation, context);
	let taskId: TaskId<ToolTaskResult>;
	if (existing?.taskId !== null && existing?.taskId !== undefined) {
		if (existing.fingerprint !== fingerprint || existing.tool !== request.tool)
			return failed("Program invocation was already used with a different tool or arguments");
		taskId = existing.taskId as TaskId<ToolTaskResult>;
		const task = await rt.harness.getTask(taskId, context);
		if (!task) return failed("Program tool outcome is unknown; it was not replayed");
		const denied = await validateSavedCall(rt, { ...request, config }, call, registration, context, conversation.id);
		if (denied) return failed(denied);
	} else {
		const extensions = programExtensions(rt, config, allowed);
		await conversation.configure(
			{
				extensions,
				tools: allowed.flatMap(({ name }) => {
					const tool = rt.tools.get(name);
					return tool ? [tool] : [];
				}),
				modelTools: allowed
					.filter(({ name }) =>
						rt.describeTools(config).some((entry) => entry.name === name && entry.exposure === "offer"),
					)
					.flatMap(({ name }) => {
						const tool = rt.tools.get(name);
						return tool ? [tool] : [];
					}),
				...(config.resolved.instructions === undefined ? {} : { instructions: config.resolved.instructions }),
				cwd: config.cwd,
			},
			context,
		);
		let createdTask: TaskId<ToolTaskResult> | undefined;
		await conversation.commit(async (tx) => {
			const invocation = await tx.doc(ProgramInvocationDoc, conversation.id, request.invocation, null);
			if (invocation.taskId !== null) {
				if (invocation.fingerprint !== fingerprint || invocation.tool !== request.tool)
					throw new Error("Program invocation was already used with a different tool or arguments");
				createdTask = invocation.taskId as TaskId<ToolTaskResult>;
				return;
			}
			const task = await tx.createTask(
				ToolTask,
				{ kind: "program", call, allowedTools: allowed.map(({ name }) => name) },
				{ ownership: { kind: "conversation" } },
			);
			const snapshot = await tx.doc(ProgramSnapshotDoc, task, "scope", null);
			snapshot.config = JSON.stringify(config);
			snapshot.events = "[]";
			snapshot.allowedTools = allowed.map(({ name }) => name);
			invocation.taskId = task;
			invocation.fingerprint = fingerprint;
			invocation.tool = request.tool;
			createdTask = task;
		}, context);
		if (createdTask === undefined) return failed("Program invocation was not admitted");
		taskId = createdTask;
	}

	let aborting: Promise<void> | undefined;
	let abortFailure: unknown;
	const abortTask = () => {
		aborting ??= rt.harness.abortTask(taskId, C).then(
			() => {},
			(error) => {
				abortFailure = error;
			},
		);
	};
	signal.addEventListener("abort", abortTask, { once: true });
	try {
		if (signal.aborted) abortTask();
		const settled = await rt.harness.waitForTask<ToolTaskResult>(taskId, context);
		const outcome = settled.state.outcome;
		const result = outcome.result;
		if (result?.kind === "program") {
			const value = fromResult(result.result);
			const text =
				value.text ||
				(result.result.diagnostics ?? [])
					.map((diagnostic) => diagnostic.message)
					.filter(Boolean)
					.join("\n");
			const reported = text === value.text ? value : { ...value, text };
			return outcome.status === "completed" ? reported : { ...reported, isError: true };
		}
		return failed(outcome.status === "failed" ? outcome.error.message : `Program tool ended as ${outcome.status}`);
	} catch (error) {
		if (signal.aborted) {
			aborting ??= rt.harness.abortTask(taskId, C).then(
				() => {},
				(failure) => {
					abortFailure = failure;
				},
			);
			await aborting;
		}
		if (abortFailure !== undefined)
			return failed(abortFailure instanceof Error ? abortFailure.message : String(abortFailure));
		return failed(error instanceof Error ? error.message : String(error));
	} finally {
		signal.removeEventListener("abort", abortTask);
	}
}

async function validateSavedCall(
	rt: RuntimeInternals,
	request: { config: RuntimeSessionConfig; tool: string },
	call: ToolCall,
	registration: NonNullable<ReturnType<RuntimeInternals["tools"]["get"]>>,
	context: Context,
	conversationId: number,
): Promise<string | undefined> {
	try {
		const prepared = registration.prepareArguments?.(call.arguments) ?? call.arguments;
		const valid = validateToolArguments(registration, {
			...call,
			arguments: prepared as Record<string, JsonValue>,
		});
		return rt.policy.denied(
			request.tool,
			valid as Record<string, JsonValue>,
			request.config,
			context,
			request.config.sessionId ?? String(conversationId),
		);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function programExtensions(rt: RuntimeInternals, config: RuntimeSessionConfig, tools: ProgramToolDescriptor[]) {
	const names = ["yonder.core", "yonder.files", "yonder.tools", "yonder.background", "yonder.todo", "yonder.process"];
	if (config.hostTools?.length) names.push("yonder.host");
	for (const plugin of config.resolved.plugins) names.push(`plugin:${plugin}`);
	if (
		tools.some(({ name }) =>
			rt.describeTools(config).some((entry) => entry.name === name && entry.exposure === "search"),
		)
	) {
		const search = [...rt.extensions.values()].find((extension) =>
			extension.tools?.some((tool) => tool.name === "tool_search"),
		);
		if (search) names.push(search.name);
	}
	return [...new Set(names)].flatMap((name) => {
		const extension = rt.extensions.get(name);
		return extension ? [extension] : [];
	});
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

const failed = (text: string): ToolResult => ({ text, isError: true });
