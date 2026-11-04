import {
	AssistantMessageComponent,
	CustomMessageComponent,
	getMarkdownTheme,
	keyText,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import { observeControl, packageVersion, type TerminalUpdate } from "@yonder/local-host";
import { chatCommands, type SessionNotification, type YEvent } from "@yonder/sdk";
import { CommandAutocomplete } from "./autocomplete.js";
import { CompactToolExecution, MessagePresentation } from "./message-presentation.js";
import { WorkingStatusIndicator, withBuiltInRenderers } from "./pi-native.js";
import type { Info, TerminalRuntime, View } from "./terminal-context.js";
import { hideReplyMarker, type Message } from "./terminal-support.js";
import type { FooterView } from "./vendor/pi-footer.js";

/** Rendering layer: builds the pi 1.3.0 component tree and applies view updates to it. */
export function createView(rt: TerminalRuntime): View {
	const { editor, chat, pending, header, ui, keys } = rt;
	const render = () => {
		if (!rt.closed) ui.requestRender();
	};
	const notice = (text: string, error = false) => {
		chat.addChild(new Text(rt.theme.fg(error ? "error" : "dim", text), 1, 0));
		render();
	};
	const guarded = (action: () => Promise<void>) => {
		void action().catch((error) => notice(error instanceof Error ? error.message : String(error), true));
	};
	const setRunning = (value: boolean, session?: string) => {
		if (session) {
			if (value) rt.activeSessions.add(session);
			else rt.activeSessions.delete(session);
		} else if (!value) rt.activeSessions.clear();
		rt.running = session ? rt.activeSessions.size > 0 : value;
		value = rt.running;
		rt.loader?.dispose();
		rt.loader = undefined;
		if (value) {
			rt.loader = new WorkingStatusIndicator(ui, "Working… · 处理中");
			editor.setWorkingStatusIndicator(rt.loader);
		} else editor.setWorkingStatusIndicator(undefined);
		render();
	};
	const footerView = (): FooterView => {
		const model = rt.info?.model ?? rt.presets.find((item) => item.id === (rt.target.preset ?? "default"))?.modelInfo;
		return {
			cwd: rt.info?.config.cwd ?? rt.home,
			label: rt.info
				? `${rt.info.agentName ?? rt.info.session.agent ?? "独立任务"}${rt.info.agentWork ? ` · ${rt.info.agentWork}` : ""} · #${rt.info.session.id}`
				: rt.target.channel
					? `渠道 ${rt.target.channel}`
					: `新任务 · ${rt.target.preset ?? "default"}`,
			hint: rt.running ? "esc 中止 · ? 快捷键" : "? 快捷键 · / 命令",
			readOnly: Boolean(!rt.target.channel && rt.info && (rt.info.session.closed || rt.info.session.mode !== "task")),
			...(model ? { model } : {}),
			thinkingLevel:
				rt.info?.config.resolved.thinking ??
				rt.presets.find((item) => item.id === (rt.target.preset ?? "default"))?.thinking ??
				"medium",
			usageTotals: rt.info?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			contextUsage: {
				contextWindow:
					rt.info?.model?.contextWindow ??
					rt.presets.find((item) => item.id === (rt.target.preset ?? "default"))?.modelInfo?.contextWindow ??
					0,
				percent: null,
			},
			status: [
				!rt.target.channel && rt.info && (rt.info.session.closed || rt.info.session.mode !== "task")
					? "只读 / Read-only"
					: rt.running
						? "运行中 / Working"
						: "就绪 / Ready",
				...(rt.info
					? [
							rt.info.session.profile,
							rt.info.config.resolved.capabilities.join(","),
							rt.info.config.resolved.level,
							rt.info.config.resolved.env,
						]
					: []),
			]
				.filter(Boolean)
				.join(" · "),
		};
	};
	const showHelp = () => {
		rt.below.clear();
		if (rt.helpVisible)
			rt.below.addChild(
				new Text(
					rt.theme.fg(
						"dim",
						[
							`${keyText("tui.input.submit")} 发送 · ${keyText("tui.input.newLine")} 换行 · tab 补全 · ↑↓ 选择 · esc 返回/中止`,
							`${keyText("app.clear")} 中止/清空，再按退出 · ${keyText("app.exit")} 空输入退出 · ${keyText("app.tools.expand")} 详情 · ${keyText("app.editor.external")} 编辑器`,
							`${keyText("tui.editor.historyPrevious")}/${keyText("tui.editor.historyNext")} 历史 · ctrl+l 重绘 · ${keyText("app.message.followUp")} 后续输入 · ${keyText("app.message.dequeue")} 取回排队输入`,
						].join("\n"),
					),
					1,
					0,
				),
			);
		render();
	};
	const title = () => {
		editor.borderColor = rt.theme.getThinkingBorderColor(
			rt.info?.config.resolved.thinking ??
				rt.presets.find((item) => item.id === (rt.target.preset ?? "default"))?.thinking ??
				"medium",
		);
		header.clear();
		header.addChild(new Spacer(1));
		header.addChild(
			new Text(
				`${rt.theme.bold(rt.theme.fg("accent", "Yonder Harness"))} ${rt.theme.fg("dim", `v${packageVersion}`)}`,
				1,
				0,
			),
		);
		render();
	};
	const autocomplete = () =>
		editor.setAutocompleteProvider(
			new CommandAutocomplete(chatCommands, rt.info?.config.cwd ?? rt.home, async () => {
				const templates = await rt
					.call<Array<{ name: string; description: string }>>(
						"terminal.templates",
						rt.info ? { id: rt.info.session.id } : rt.target.channel ? {} : { preset: rt.target.preset ?? "default" },
					)
					.catch(() => []);
				return templates.map(({ name, description }) => ({ value: name, label: name, description }));
			}),
		);
	const refresh = async (id = rt.info?.session.id) => {
		if (id) {
			const epoch = rt.viewEpoch;
			const next = await rt.call<Info>("terminal.info", { id });
			if (epoch !== rt.viewEpoch || rt.info?.session.id !== id) return;
			rt.info = next;
			title();
			autocomplete();
			editor.borderColor = rt.theme.getThinkingBorderColor(next.config.resolved.thinking);
		}
	};
	const toolComponent = (session: string, id: string, name: string, args: object = {}) => {
		const key = `${session}:${id}`;
		let tool = rt.tools.get(key);
		if (!tool) {
			tool = new CompactToolExecution(
				name,
				id,
				args,
				{ outputPad: 1 },
				withBuiltInRenderers(name),
				ui,
				rt.info?.config.cwd ?? rt.home,
			);
			tool.setExpanded(rt.toolsExpanded);
			tool.onToggle = render;
			rt.tools.set(key, tool);
			chat.addChild(tool);
		}
		return tool;
	};
	const showMessage = (session: string, id: string, value: object, streaming = false) => {
		const message = value as Message;
		const key = `${session}:${id}`;
		if (message.role === "user") {
			if (rt.entries.has(key)) return;
			const text =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((item) => item.type === "text")
							.map((item) => item.text ?? "")
							.join("\n");
			const component = new UserMessageComponent(
				text.replace(/^<turn\b[\s\S]*?<\/turn>\s*/, ""),
				getMarkdownTheme(),
				0,
			);
			rt.entries.set(key, component);
			chat.addChild(new MessagePresentation(component, "›", true));
		} else if (message.role === "assistant") {
			const text = message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (!message.content.some((block) => block.type === "toolCall") && hideReplyMarker(text, streaming ?? false))
				return;
			rt.lastAssistantText = text;
			let component = (id === "live" ? rt.live.get(session) : rt.entries.get(key)) as
				| AssistantMessageComponent
				| undefined;
			if (!component && id !== "live") {
				component = rt.live.get(session);
				if (component) rt.live.delete(session);
			}
			if (!component) {
				component = new AssistantMessageComponent(message, rt.hideThinking, getMarkdownTheme(), "", 0);
				rt.assistants.add(component);
				const speaker = rt.speakers.get(session) ?? rt.info?.agentName ?? rt.info?.session.agent;
				chat.addChild(new MessagePresentation(component, speaker && speaker !== "AI" ? `• ${speaker}` : "•"));
			}
			component.updateContent(message, streaming);
			if (id === "live") rt.live.set(session, component);
			else rt.entries.set(key, component);
			for (const block of message.content)
				if (block.type === "toolCall" && !streaming) toolComponent(session, block.id, block.name, block.arguments);
		} else if (message.role === "toolResult") {
			const tool = toolComponent(session, message.toolCallId, message.toolName);
			tool.updateResult({ content: message.content, isError: message.isError });
			rt.entries.set(key, tool);
		}
		render();
	};
	const showNotification = (session: string, value: SessionNotification) => {
		const key = `${session}:notification:${value.id}`;
		if (rt.entries.has(key)) return;
		const component = new CustomMessageComponent(
			{ role: "custom", customType: `通知 · ${value.from}`, content: value.text, display: true, timestamp: 0 },
			undefined,
			getMarkdownTheme(),
			1,
		);
		rt.entries.set(key, component);
		chat.addChild(component);
		render();
	};
	const receive = (session: string, packet: unknown) => {
		const envelope = packet as { type: string; update?: TerminalUpdate; error?: string };
		if (envelope.type === "disconnected") {
			const observer = rt.observers.get(session);
			rt.observers.delete(session);
			observer?.close();
			rt.disconnected.add(session);
			setRunning(false, session);
			notice(`连接已断开 / Disconnected: ${envelope.error}. yonder chat --session ${session}`, true);
			return;
		}
		const update = envelope.update;
		if (!update) return;
		if (update.type === "snapshot") {
			if (update.items) {
				for (const item of update.items) {
					if (item.notification) showNotification(session, item.notification);
					else if (item.message) showMessage(session, item.id, item.message);
				}
			} else for (const item of update.messages ?? []) showMessage(session, item.id, item.message);
			setRunning(update.running ?? false, session);
		} else if (update.type === "notification" && update.notification) showNotification(session, update.notification);
		else if (update.type === "message" && update.message)
			showMessage(session, update.id ?? "live", update.message, update.streaming);
		else if (update.type === "tool" && update.tool) {
			const item = update.tool,
				tool = toolComponent(session, item.id, item.name, item.args);
			if (item.phase === "start") {
				tool.updateArgs(item.args ?? {});
				tool.setArgsComplete();
				tool.markExecutionStarted();
			}
			if (item.result) tool.updateResult(item.result as Parameters<CompactToolExecution["updateResult"]>[0]);
			else if (item.phase === "update")
				tool.updateResult({ content: [{ type: "text", text: item.text ?? "" }], isError: false }, true);
			else if (item.phase === "end") notice(`${item.name}: 结果未知 / Result unavailable`, true);
			render();
		} else if (update.type === "state") setRunning(update.running ?? false, session);
		else if (update.type === "inbox") {
			guarded(async () => {
				const epoch = rt.viewEpoch;
				const items = await rt.call<Array<{ mode: string; text: string }>>("terminal.queued", { id: session });
				if (epoch !== rt.viewEpoch || rt.info?.session.id !== session) return;
				pending.clear();
				if (items.length) pending.addChild(new Spacer(1));
				for (const item of items)
					pending.addChild(
						new TruncatedText(
							rt.theme.fg("dim", `${item.mode === "steer" ? "Steering" : "Follow-up"}: ${item.text}`),
							1,
							0,
						),
					);
				if (items.length)
					pending.addChild(
						new TruncatedText(
							rt.theme.fg("dim", `↳ ${keys.getKeys("app.message.dequeue").join("/")} to edit all queued messages`),
							1,
							0,
						),
					);
				render();
			});
		} else if (update.type === "end") {
			const event = update.event as YEvent | undefined;
			const data = event?.data as { status?: string; reason?: string } | undefined;
			if (data?.status && data.status !== "done")
				notice(`${data.status}: ${data.reason ?? ""}`, data.status === "error");
			void refresh(session).catch((error) => notice(String(error), true));
		} else if (update.type === "error") notice(update.error ?? "Error", true);
	};
	const watch = async (id: string): Promise<void> => {
		if (rt.observers.has(id)) return;
		const existing = rt.watching.get(id);
		if (existing) return existing;
		const pendingWatch = (async () => {
			const epoch = rt.viewEpoch;
			const next = await rt.call<Info>("terminal.info", { id });
			if (epoch !== rt.viewEpoch) return;
			rt.speakers.set(id, next.agentName ?? next.session.agent ?? "AI");
			const observation = await observeControl(rt.home, { method: "sessions.watch", params: { id } }, (value) => {
				if (epoch === rt.viewEpoch) receive(id, value);
			});
			if (epoch !== rt.viewEpoch) {
				observation.close();
				return;
			}
			rt.observers.set(id, observation);
			rt.disconnected.delete(id);
			if (!rt.info || rt.target.session === id) rt.info = observation.result as Info;
			title();
			autocomplete();
		})();
		rt.watching.set(id, pendingWatch);
		try {
			await pendingWatch;
		} finally {
			if (rt.watching.get(id) === pendingWatch) rt.watching.delete(id);
		}
	};
	const disconnect = () => {
		rt.viewEpoch++;
		rt.disconnected.clear();
		rt.watching.clear();
		for (const observer of rt.observers.values()) observer.close();
		rt.observers.clear();
		rt.channelSocket?.destroy();
		rt.channelSocket = undefined;
	};
	const reset = () => {
		disconnect();
		rt.info = undefined;
		chat.clear();
		pending.clear();
		rt.entries.clear();
		rt.live.clear();
		rt.tools.clear();
		rt.assistants.clear();
		setRunning(false);
	};
	return {
		render,
		notice,
		setRunning,
		guarded,
		showHelp,
		title,
		autocomplete,
		refresh,
		footerView,
		toolComponent,
		showMessage,
		showNotification,
		receive,
		watch,
		disconnect,
		reset,
	};
}
