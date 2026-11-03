import type { AgentConfig, YonderConfig } from "@yonder/bot-definition";
import { promptErrors, resolveProfile } from "@yonder/bot-definition";
import { exactConvProfile } from "@yonder/bot-definition/bindings";
import { socialReferenceErrors } from "@yonder/bot-definition/social-validation";
import type { Models, Preset, SessionInfo, YEvent } from "@yonder/sdk";
import type { LoadedPlugins } from "../plugins/index.js";
import { sessionKey } from "../routing/matching.js";
export function profileContexts(agent: AgentConfig, defaultModel?: string): string[] {
	const contexts = Object.values(agent.profiles).flatMap(
		(profile) => resolveProfile(profile, agent.defaults, "local", defaultModel).contexts,
	);
	return [...new Set(contexts)];
}
function bindingMapsSession(binding: AgentConfig["bindings"][number], session: SessionInfo) {
	if (session.mode !== "persistent" || typeof binding.session === "string") return false;
	const values = (value: string | string[] | undefined) =>
		value === undefined ? [] : Array.isArray(value) ? value : [value];
	const probes: Array<{ conv?: string; from?: string; person?: string }> =
		binding.session.per === "conv"
			? values(binding.match.conv).map((conv) => ({ conv }))
			: binding.session.per === "from"
				? values(binding.match.from)
						.filter((from) => from.startsWith("acct:"))
						.map((from) => ({ from }))
				: values(binding.match.from)
						.filter((from) => from.startsWith("person:"))
						.map((person) => ({ person }));
	return probes.some(({ conv, from, person }) => {
		const event: YEvent = {
			id: session.id,
			ts: session.opened,
			type: "message.in",
			data: {},
			...(conv ? { conv } : {}),
			...((from ?? (person ? `acct:${person}` : undefined)) ? { from: from ?? `acct:${person}` } : {}),
		};
		return sessionKey(binding, event, person).key === session.key;
	});
}
function changedSessionRouteProfile(
	previous: AgentConfig | undefined,
	next: AgentConfig | undefined,
	session: SessionInfo,
) {
	if (!previous || !next || session.mode !== "persistent") return;
	for (const oldBinding of previous.bindings) {
		const nextBinding = next.bindings.find((binding) => binding.id === oldBinding.id);
		if (!nextBinding) continue;
		const { profile: _oldProfile, ...oldShape } = oldBinding;
		const { profile: _nextProfile, ...nextShape } = nextBinding;
		if (JSON.stringify(oldShape) !== JSON.stringify(nextShape) || !bindingMapsSession(oldBinding, session)) continue;
		const oldProfile = oldBinding.profile ?? previous.defaultProfile;
		const nextProfile = nextBinding.profile ?? next.defaultProfile;
		if (session.profile === oldProfile && oldProfile !== nextProfile) return { oldProfile, nextProfile };
	}
	const override = session.key.startsWith("conv:") && exactConvProfile(next, session.key.slice("conv:".length));
	return override && session.profile !== override ? { oldProfile: session.profile, nextProfile: override } : undefined;
}
export function protectSessions(
	config: YonderConfig,
	candidate: YonderConfig,
	agents: Map<string, AgentConfig>,
	nextAgents: Map<string, AgentConfig>,
	presets: Map<string, Preset>,
	nextPresets: Map<string, Preset>,
	sessions: SessionInfo[],
	errors: string[],
) {
	for (const session of sessions) {
		if (session.agent) {
			const before = config.agents?.find((a) => a.id === session.agent),
				after = candidate.agents?.find((a) => a.id === session.agent);
			if (!nextAgents.get(session.agent)?.profiles[session.profile])
				errors.push(
					`session ${session.id}: close session before removing agent/profile ${session.profile}; the profile is still used by an open session. Finish or close it through the session workflow, then rerun agents validate and read back with agents show`,
				);
			const previous = agents.get(session.agent),
				next = nextAgents.get(session.agent);
			const oldProfile = previous?.profiles[session.profile],
				newProfile = next?.profiles[session.profile];
			const changedRoute = changedSessionRouteProfile(previous, next, session);
			if (changedRoute)
				errors.push(
					`session ${session.id}: close before changing binding profile ${changedRoute.oldProfile} to ${changedRoute.nextProfile}; this open session would keep its existing profile. Run yonder sessions close ${session.id}, then rerun agents validate/update and inspect the next session's profile`,
				);
			const envChanged =
				oldProfile &&
				newProfile &&
				resolveProfile(oldProfile, previous?.defaults, before?.env, config.defaultModel).env !==
					resolveProfile(newProfile, next?.defaults, after?.env, candidate.defaultModel).env;
			if (before?.workspace !== after?.workspace || before?.env !== after?.env || envChanged)
				errors.push(
					`session ${session.id}: close before changing workspace/env; they are fixed for this open session. Finish or close the session first, then rerun agents validate/update and inspect the new session's cwd/env`,
				);
		} else if (presets.has(session.profile) && !nextPresets.has(session.profile))
			errors.push(
				`session ${session.id}: close session before removing preset ${session.profile}; it is still used by an open session. Finish or close it first, then rerun presets validate and read back with presets show`,
			);
	}
	for (const id of agents.keys()) if (!nextAgents.has(id)) errors.push(`agent ${id}: archive instead of unregistering`);
}
export function configurationErrors(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	plugins: LoadedPlugins,
	models: Models,
	presets: Map<string, Preset>,
	options: { strictBatchConsumers?: boolean } = {},
): string[] {
	const errors: string[] = socialReferenceErrors(
		config,
		agents,
		new Set(plugins.info?.map((plugin) => plugin.id) ?? []),
		plugins.channels,
		options,
	);
	const validateProfile = (name: string, selected: ReturnType<typeof resolveProfile>) => {
		errors.push(...promptErrors(selected.prompt).map((error) => `${name}: ${error}`));
		for (const ref of [selected.model, ...(selected.fallback?.models ?? [])]) {
			const slash = ref.indexOf("/");
			if (!models.getModel(ref.slice(0, slash), ref.slice(slash + 1)))
				errors.push(
					`${name}: unknown model ${ref}; use yonder models list --home <active home> to confirm a real provider/modelId, correct this profile or fallback, then rerun agents validate and inspect`,
				);
		}
		if (selected.env !== "local" && !plugins.envs.has(selected.env))
			errors.push(
				`${name}: environment ${selected.env} is not provided by a loaded plugin; check yonder plugins list and the active home's plugins, select the actual contributed environment id, then rerun agents validate and inspect`,
			);
		for (const id of selected.contexts)
			if (!plugins.contexts.has(id))
				errors.push(
					`${name}: context ${id} is unavailable; check yonder plugins list/show for its contributing plugin and select an actual context id, then rerun agents validate and inspect`,
				);
		for (const id of selected.plugins)
			if (!plugins.tools.has(id))
				errors.push(
					`${name}: plugin ${id} is not loaded with tools in this home; check yonder plugins list/show, load its actual package/source if needed and restart, then rerun agents validate and inspect`,
				);
	};
	for (const agent of agents.values()) {
		if (agent.archivedAt) continue;

		for (const [name, profile] of Object.entries(agent.profiles)) {
			const selected = resolveProfile(
				profile,
				agent.defaults,
				config.agents?.find((item) => item.id === agent.id)?.env,
				config.defaultModel,
			);
			validateProfile(`${agent.id}/${name}`, selected);
		}
		for (const binding of agent.bindings) {
			const ids =
				binding.match.channel === undefined ? [...plugins.channels.keys(), "agent"] : [binding.match.channel].flat();
			const kinds = binding.match.kind === undefined ? [] : [binding.match.kind].flat();
			for (const id of ids) {
				const supported = id === "agent" ? ["agent", "parent-request"] : plugins.channels.get(id)?.kinds;
				if (!supported && !plugins.channelErrors.has(id)) {
					errors.push(`${agent.id}/${binding.id}: unknown channel ${id}`);
				}
			}
			for (const kind of kinds)
				if (
					!ids.some(
						(id) =>
							plugins.channelErrors.has(id) ||
							(id === "agent" ? ["agent", "parent-request"] : plugins.channels.get(id)?.kinds)?.includes(kind),
					)
				)
					errors.push(`${agent.id}/${binding.id}: no selected channel declares kind ${kind}`);
		}
	}
	for (const [id, preset] of presets)
		validateProfile(`preset:${id}`, resolveProfile(preset, {}, "local", config.defaultModel));
	return errors;
}
