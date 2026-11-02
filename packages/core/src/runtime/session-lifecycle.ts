import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Capability } from "@yonder/sdk";
import { forkConversation, forkParent } from "./branches.js";
import { cid, SessionDoc } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import type { RuntimeSessionState } from "./types.js";

export async function createSession(
	rt: RuntimeInternals,
	meta: {
		agent: string | null;
		profile: string;
		cwd: string;
		env?: string;
		capabilities?: Capability[];
		channelInstances?: string[];
		inherit?: RuntimeSessionState["inherit"];
		close?: "run-end" | "manual";
	},
): Promise<string> {
	const conversation = await rt.harness.createConversation(
		{
			ownership: { kind: "ownerless" },
			init: async (tx, id) => {
				Object.assign(await tx.doc(SessionDoc, id), {
					agent: meta.agent,
					profile: meta.profile,
					cwd: meta.cwd,
					env: meta.env ?? "local",
					capabilities: meta.capabilities ?? null,
					channelInstances: meta.channelInstances ?? null,
					inherit: meta.inherit ?? null,
					close: meta.close ?? "run-end",
				});
			},
		},
		C,
	);
	return String(conversation.id);
}
export async function fork(rt: RuntimeInternals, id: string, at: number): Promise<string> {
	if (await rt.hasPendingWork(id)) throw new Error("Cannot fork a session with pending work");
	return forkConversation(await rt.conversation(id), id, at);
}
export async function parentOf(rt: RuntimeInternals, id: string): Promise<{ id: string; at: number } | undefined> {
	return forkParent(rt.storage, id);
}
export async function sessionState(rt: RuntimeInternals, id: string): Promise<RuntimeSessionState | undefined> {
	const state = await rt.harness.snapshot(SessionDoc, cid(id), C);
	if (!state) return;
	return {
		...(state.workbench ? { workbench: structuredClone(state.workbench) } : {}),
		...(state.judgment ? { judgment: true } : {}),
		...(state.models ? { models: structuredClone(state.models) } : {}),
		agent: state.agent,
		profile: state.profile,
		close: state.close ?? "run-end",
		cwd: state.cwd,
		env: state.env,
		...(state.capabilities ? { capabilities: [...state.capabilities] } : {}),
		...(state.channelInstances ? { channelInstances: [...state.channelInstances] } : {}),
		...(state.inherit ? { inherit: structuredClone(state.inherit) } : {}),
	};
}
export async function setSessionState(rt: RuntimeInternals, id: string, state: RuntimeSessionState): Promise<void> {
	await (await rt.conversation(id)).commit(async (tx) => {
		Object.assign(await tx.doc(SessionDoc, cid(id)), {
			...state,
			workbench: state.workbench ?? null,
			capabilities: state.capabilities ?? null,
			channelInstances: state.channelInstances ?? null,
			inherit: state.inherit ?? null,
		});
	}, C);
	if (!(await rt.hasPendingWork(id))) rt.configured.delete(id);
}
