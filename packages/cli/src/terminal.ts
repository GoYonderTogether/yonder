import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	AssistantMessageComponent,
	CustomEditor,
	CustomMessageComponent,
	copyToClipboard,
	ExtensionSelectorComponent,
	getMarkdownTheme,
	keyText,
	SessionSelectorComponent,
	type Theme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	Markdown,
	Spacer,
	setKeybindings,
	Text,
	TruncatedText,
} from "@earendil-works/pi-tui";
import {
	cliChannelEndpoint,
	type Kernel,
	observeControl,
	packageVersion,
	requestControl,
	type TerminalUpdate,
} from "@yonder/core";
import type { SessionInfo, SessionNotification, YEvent } from "@yonder/sdk";
import { chatCommands } from "@yonder/sdk";
import { CommandAutocomplete } from "./autocomplete.js";
import { branchCommand } from "./branch-commands.js";
import { CompactToolExecution, MessagePresentation } from "./message-presentation.js";
import {
	createChatViewport,
	createInteractiveTui,
	editInExternalEditor,
	KeybindingsManager,
	nativeTheme,
	syncTerminalTheme,
	WorkingStatusIndicator,
	withBuiltInRenderers,
} from "./pi-native.js";
import { type ChatTarget, hideReplyMarker, type Message, sameDirectory } from "./terminal-support.js";
import { FooterComponent, type FooterView } from "./vendor/pi-footer.js";

export { type ChatTarget, hideReplyMarker, sameDirectory } from "./terminal-support.js";

type Info = Awaited<ReturnType<Kernel["terminal"]["info"]>>;
type Presets = ReturnType<Kernel["terminal"]["presets"]>;
type Channels = ReturnType<Kernel["terminal"]["channels"]>;

export { chatCommands };

/** Native pi 1.3.0 component tree and actions; Yonder supplies content, transport and the spec/12 §6 presentation adapter. */
export async function runTerminal(home: string, initial: ChatTarget = {}) {
	const keys = new KeybindingsManager({
		"tui.editor.historyPrevious": "ctrl+p",
		"tui.editor.historyNext": "ctrl+n",
		"app.thinking.toggle": [],
	});
	setKeybindings(keys);
	const ui = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: join(home, ".yonder/logs"),
	});
	let theme: Theme = nativeTheme.theme;
	const document = new Container(),
		header = new Container(),
		chat = new Container();
	document.addChild(header);
	document.addChild(chat);
	const pending = new Container(),
		status = new Container(),
		above = new Container(),
		below = new Container();
	above.addChild(new Spacer(1));
	const editor = new CustomEditor(ui, nativeTheme.getEditorTheme(), keys, {
		paddingX: 1,
		autocompleteMaxVisible: 5,
		embedWorkingStatus: true,
	});
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	let info: Info | undefined;
	let opening: Promise<void> | undefined;
	let presets: Presets = [];
	let target = { ...initial };
	let running = false,
		closed = false,
		toolsExpanded = false,
		hideThinking = true,
		helpVisible = false,
		clearPressedAt = 0;
	let loader: InstanceType<typeof WorkingStatusIndicator> | undefined;
	let channelSocket: Socket | undefined;
	const observers = new Map<string, { close(): void }>();
	const disconnected = new Set<string>();
	const watching = new Map<string, Promise<void>>();
	let viewEpoch = 0;
	const entries = new Map<string, Component>();
	const live = new Map<string, AssistantMessageComponent>();
	const tools = new Map<string, CompactToolExecution>();
	const assistants = new Set<AssistantMessageComponent>();
	const activeSessions = new Set<string>();
	const speakers = new Map<string, string>();
	let lastAssistantText = "";
	let modal: Component | undefined;
	let finish!: () => void;
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const call = <T>(method: string, params?: object): Promise<T> =>
		requestControl(home, { method, ...(params ? { params } : {}) }) as Promise<T>;
	const footerView = (): FooterView => {
		const model = info?.model ?? presets.find((item) => item.id === (target.preset ?? "default"))?.modelInfo;
		return {
			cwd: info?.config.cwd ?? home,
			label: info
				? `${info.agentName ?? info.session.agent ?? "独立任务"}${info.agentWork ? ` · ${info.agentWork}` : ""} · #${info.session.id}`
				: target.channel
					? `渠道 ${target.channel}`
					: `新任务 · ${target.preset ?? "default"}`,
			hint: running ? "esc 中止 · ? 快捷键" : "? 快捷键 · / 命令",
			readOnly: Boolean(!target.channel && info && (info.session.closed || info.session.mode !== "task")),
			...(model ? { model } : {}),
			thinkingLevel:
				info?.config.resolved.thinking ??
				presets.find((item) => item.id === (target.preset ?? "default"))?.thinking ??
				"medium",
			usageTotals: info?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			contextUsage: {
				contextWindow:
					info?.model?.contextWindow ??
					presets.find((item) => item.id === (target.preset ?? "default"))?.modelInfo?.contextWindow ??
					0,
				percent: null,
			},
			status: [
				!target.channel && info && (info.session.closed || info.session.mode !== "task")
					? "只读 / Read-only"
					: running
						? "运行中 / Working"
						: "就绪 / Ready",
				...(info
					? [
							info.session.profile,
							info.config.resolved.capabilities.join(","),
							info.config.resolved.level,
							info.config.resolved.env,
						]
					: []),
			]
				.filter(Boolean)
				.join(" · "),
		};
	};
	const footer = new FooterComponent(footerView);
	const footerContainer = new Container();
	footerContainer.addChild(footer);
	const viewport = createChatViewport({
		document,
		pendingMessages: pending,
		status,
		widgetsAbove: above,
		editor: editorContainer,
		widgetsBelow: below,
		footer: footerContainer,
		scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
		scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
	});
	for (const child of [document, pending, status, above, editorContainer, below, footerContainer]) ui.addChild(child);
	ui.setLayoutRoot(viewport.root);
	ui.setFocus(editor);
	const render = () => {
		if (!closed) ui.requestRender();
	};
	const notice = (text: string, error = false) => {
		chat.addChild(new Text(theme.fg(error ? "error" : "dim", text), 1, 0));
		render();
	};
	const setRunning = (value: boolean, session?: string) => {
		if (session) {
			if (value) activeSessions.add(session);
			else activeSessions.delete(session);
		} else if (!value) activeSessions.clear();
		running = session ? activeSessions.size > 0 : value;
		value = running;
		loader?.dispose();
		loader = undefined;
		if (value) {
			loader = new WorkingStatusIndicator(ui, "Working… · 处理中");
			editor.setWorkingStatusIndicator(loader);
		} else editor.setWorkingStatusIndicator(undefined);
		render();
	};
	const showHelp = () => {
		below.clear();
		if (helpVisible)
			below.addChild(
				new Text(
					theme.fg(
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
		editor.borderColor = theme.getThinkingBorderColor(
			info?.config.resolved.thinking ??
				presets.find((item) => item.id === (target.preset ?? "default"))?.thinking ??
				"medium",
		);
		header.clear();
		header.addChild(new Spacer(1));
		header.addChild(
			new Text(`${theme.bold(theme.fg("accent", "Yonder Harness"))} ${theme.fg("dim", `v${packageVersion}`)}`, 1, 0),
		);
		render();
	};
	const autocomplete = () =>
		editor.setAutocompleteProvider(new CommandAutocomplete(chatCommands, info?.config.cwd ?? home));
	const refresh = async (id = info?.session.id) => {
		if (id) {
			const epoch = viewEpoch;
			const next = await call<Info>("terminal.info", { id });
			if (epoch !== viewEpoch || info?.session.id !== id) return;
			info = next;
			title();
			autocomplete();
			editor.borderColor = theme.getThinkingBorderColor(info.config.resolved.thinking);
		}
	};
	const toolComponent = (session: string, id: string, name: string, args: object = {}) => {
		const key = `${session}:${id}`;
		let tool = tools.get(key);
		if (!tool) {
			tool = new CompactToolExecution(
				name,
				id,
				args,
				{ outputPad: 1 },
				withBuiltInRenderers(name),
				ui,
				info?.config.cwd ?? home,
			);
			tool.setExpanded(toolsExpanded);
			tool.onToggle = render;
			tools.set(key, tool);
			chat.addChild(tool);
		}
		return tool;
	};
	const showMessage = (session: string, id: string, value: object, streaming = false) => {
		const message = value as Message;
		const key = `${session}:${id}`;
		if (message.role === "user") {
			if (entries.has(key)) return;
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
			entries.set(key, component);
			chat.addChild(new MessagePresentation(component, "›", true));
		} else if (message.role === "assistant") {
			const text = message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (!message.content.some((block) => block.type === "toolCall") && hideReplyMarker(text, streaming ?? false))
				return;
			lastAssistantText = text;
			let component = (id === "live" ? live.get(session) : entries.get(key)) as AssistantMessageComponent | undefined;
			if (!component && id !== "live") {
				component = live.get(session);
				if (component) live.delete(session);
			}
			if (!component) {
				component = new AssistantMessageComponent(message, hideThinking, getMarkdownTheme(), "", 0);
				assistants.add(component);
				const speaker = speakers.get(session) ?? info?.agentName ?? info?.session.agent;
				chat.addChild(new MessagePresentation(component, speaker && speaker !== "AI" ? `• ${speaker}` : "•"));
			}
			component.updateContent(message, streaming);
			if (id === "live") live.set(session, component);
			else entries.set(key, component);
			for (const block of message.content)
				if (block.type === "toolCall" && !streaming) toolComponent(session, block.id, block.name, block.arguments);
		} else if (message.role === "toolResult") {
			const tool = toolComponent(session, message.toolCallId, message.toolName);
			tool.updateResult({ content: message.content, isError: message.isError });
			entries.set(key, tool);
		}
		render();
	};
	const showNotification = (session: string, value: SessionNotification) => {
		const key = `${session}:notification:${value.id}`;
		if (entries.has(key)) return;
		const component = new CustomMessageComponent(
			{ role: "custom", customType: `通知 · ${value.from}`, content: value.text, display: true, timestamp: 0 },
			undefined,
			getMarkdownTheme(),
			1,
		);
		entries.set(key, component);
		chat.addChild(component);
		render();
	};
	const receive = (session: string, packet: unknown) => {
		const envelope = packet as { type: string; update?: TerminalUpdate; error?: string };
		if (envelope.type === "disconnected") {
			const observer = observers.get(session);
			observers.delete(session);
			observer?.close();
			disconnected.add(session);
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
				const epoch = viewEpoch;
				const items = await call<Array<{ mode: string; text: string }>>("terminal.queued", { id: session });
				if (epoch !== viewEpoch || info?.session.id !== session) return;
				pending.clear();
				if (items.length) pending.addChild(new Spacer(1));
				for (const item of items)
					pending.addChild(
						new TruncatedText(
							theme.fg("dim", `${item.mode === "steer" ? "Steering" : "Follow-up"}: ${item.text}`),
							1,
							0,
						),
					);
				if (items.length)
					pending.addChild(
						new TruncatedText(
							theme.fg("dim", `↳ ${keys.getKeys("app.message.dequeue").join("/")} to edit all queued messages`),
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
		if (observers.has(id)) return;
		const existing = watching.get(id);
		if (existing) return existing;
		const pendingWatch = (async () => {
			const epoch = viewEpoch;
			const next = await call<Info>("terminal.info", { id });
			if (epoch !== viewEpoch) return;
			speakers.set(id, next.agentName ?? next.session.agent ?? "AI");
			const observation = await observeControl(home, { method: "sessions.watch", params: { id } }, (value) => {
				if (epoch === viewEpoch) receive(id, value);
			});
			if (epoch !== viewEpoch) {
				observation.close();
				return;
			}
			observers.set(id, observation);
			disconnected.delete(id);
			if (!info || target.session === id) info = observation.result as Info;
			title();
			autocomplete();
		})();
		watching.set(id, pendingWatch);
		try {
			await pendingWatch;
		} finally {
			if (watching.get(id) === pendingWatch) watching.delete(id);
		}
	};
	const disconnect = () => {
		viewEpoch++;
		disconnected.clear();
		watching.clear();
		for (const observer of observers.values()) observer.close();
		observers.clear();
		channelSocket?.destroy();
		channelSocket = undefined;
	};
	const reset = () => {
		disconnect();
		info = undefined;
		chat.clear();
		pending.clear();
		entries.clear();
		live.clear();
		tools.clear();
		assistants.clear();
		setRunning(false);
	};
	const guarded = (action: () => Promise<void>) => {
		void action().catch((error) => notice(error instanceof Error ? error.message : String(error), true));
	};
	const closeModal = () => {
		if (modal) {
			editorContainer.clear();
			editorContainer.addChild(editor);
			modal = undefined;
			ui.setFocus(editor);
			render();
		}
	};
	const choose = (heading: string, options: string[]): Promise<string | undefined> =>
		new Promise((resolve) => {
			const selector = new ExtensionSelectorComponent(
				heading,
				options,
				(value) => {
					selector.dispose();
					closeModal();
					resolve(value);
				},
				() => {
					selector.dispose();
					closeModal();
					resolve(undefined);
				},
			);
			modal = selector;
			editorContainer.clear();
			editorContainer.addChild(selector);
			ui.setFocus(selector);
			render();
		});
	const newTask = async () => {
		presets = await call<Presets>("terminal.presets");
		const labels = presets.map((item) => `${item.id} · ${item.description}`);
		const selected = await choose("新建会话 · New session", labels);
		if (!selected) return;
		const preset = presets[labels.indexOf(selected)];
		if (!preset) return;
		reset();
		target = { preset: preset.id };
		title();
		autocomplete();
	};
	const resume = async () => {
		const loader = async (currentOnly = false) =>
			(await call<Awaited<ReturnType<Kernel["terminal"]["list"]>>>("terminal.sessions"))
				.filter((row) => !currentOnly || sameDirectory(row.cwd, info?.config.cwd ?? home))
				.map((row) => ({
					path: row.id,
					id: row.id,
					cwd: row.cwd,
					name: `#${row.id} · ${row.agentName ?? row.agent ?? "独立任务"}${row.agentWork ? ` · ${row.agentWork}` : ""} · ${row.profile}${row.closed ? " · 已关闭/Closed" : ""}`,
					created: new Date(row.opened),
					modified: new Date(row.modified),
					messageCount: row.messageCount,
					firstMessage: row.firstMessage,
					allMessagesText: row.allMessagesText,
				}));
		const selector = new SessionSelectorComponent(
			() => loader(true),
			() => loader(false),
			(id) => {
				closeModal();
				guarded(async () => {
					reset();
					target = { session: id };
					await watch(id);
				});
			},
			closeModal,
			closeModal,
			render,
			{ keybindings: keys, showRenameHint: false },
			info?.session.id,
		);
		selector.getSessionList().onDeleteSession = async () => {
			notice("请使用 /close 关闭任务；历史保留 / Use /close; history is retained", true);
		};
		modal = selector;
		editorContainer.clear();
		editorContainer.addChild(selector);
		ui.setFocus(selector);
		render();
	};
	const enterChannel = async (id: string) => {
		reset();
		target = { channel: id };
		title();
		autocomplete();
		const socket = createConnection(cliChannelEndpoint(home, id));
		channelSocket = socket;
		socket.setEncoding("utf8");
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		lines.on("line", (line) => {
			if (channelSocket !== socket) return;
			try {
				const packet = JSON.parse(line) as { type: string; event?: YEvent; message?: string };
				if (packet.type === "accepted" && packet.event) {
					const routes = packet.event.routes ?? [];
					for (const route of routes) if (route.session) speakers.set(route.session, route.agent);
					for (const route of routes)
						if (route.session)
							guarded(async () => {
								await watch(route.session as string);
							});
					if (!routes.some((route) => route.wake === "run"))
						notice(
							`输入已接纳，未唤醒模型 / Accepted without running: ${routes.map((route) => `${route.agent}: ${route.dropped ?? route.wake}`).join(", ")}`,
						);
				} else if (packet.type === "error") notice(packet.message ?? "Channel error", true);
			} catch (error) {
				notice(String(error), true);
			}
		});
		socket.on("error", (error) => notice(error.message, true));
		socket.on("close", () => {
			if (!closed && channelSocket === socket) notice("渠道连接已断开 / Channel disconnected", true);
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		const channel = (await call<Channels>("terminal.channels")).find((channel) => channel.id === id);
		const mains = await call<SessionInfo[]>("sessions.list", { filter: { mode: "main", open: true } });
		for (const session of mains)
			if (channel?.agents.some((agent) => agent.id === session.agent && agent.main)) {
				speakers.set(
					session.id,
					channel.agents.find((agent) => agent.id === session.agent)?.name ?? session.agent ?? "",
				);
				await watch(session.id);
			}
	};
	const stop = async () => {
		const ids = [...observers.keys()];
		if (!ids.length) return;
		const id =
			ids.length === 1 ? ids[0] : await choose("中止整个会话及排队输入 · Abort session and queued inputs", ids);
		if (id) {
			if (!target.channel) {
				const withdrawn = await call<Array<{ text: string }>>("terminal.dequeue", { id });
				if (withdrawn.length)
					editor.setText([...withdrawn.map((item) => item.text), editor.getText()].filter(Boolean).join("\n\n"));
			}
			await call("sessions.abort", { id });
		}
	};
	const command = async (line: string) => {
		const name = line.slice(1).trim();
		if (name === "new") return newTask();
		if (name === "resume") return resume();
		if (name === "tree" || /^fork(?:\s+\d+)?$/.test(name)) {
			if (!info || target.channel) throw new Error("请先选择独立任务 / Select a standalone task");
			return branchCommand(
				name,
				info.session.id,
				call,
				choose,
				async (id) => {
					reset();
					target = { session: id };
					await watch(id);
				},
				notice,
			);
		}
		if (name === "channel") {
			const channels = await call<Channels>("terminal.channels");
			const labels = channels.map(
				(channel) =>
					`${channel.id} · ${channel.agents.map((agent) => `${agent.name}${agent.work ? ` · ${agent.work}` : ""}`).join(", ") || "无绑定/Unbound"}`,
			);
			const selected = await choose("渠道聊天 · Channel chat", labels);
			const channel = selected ? channels[labels.indexOf(selected)] : undefined;
			if (channel) await enterChannel(channel.id);
			return;
		}
		if (/^connect(?:\s+[a-z0-9-]+)?$/.test(name)) {
			const instance = name.split(/\s+/)[1];
			const result = await call<{ instance: string; status: string; qrcodeUrl?: string }>(
				"channels.login",
				instance ? { instance } : {},
			);
			notice(
				[
					`渠道 ${result.instance}: ${result.status}`,
					result.qrcodeUrl ? `请用微信扫码：[打开接入链接](${result.qrcodeUrl})` : undefined,
				]
					.filter(Boolean)
					.join("\n"),
			);
			return;
		}
		if (name === "stop") return stop();
		if (name === "close") {
			if (info?.session.mode !== "task" || info.session.close !== "manual" || target.channel)
				throw new Error("仅可关闭独立任务 / Only standalone tasks can be closed");
			if (
				running &&
				(await choose("中止并关闭？ · Abort and close?", ["返回 · Back", "中止并关闭 · Abort and close"])) !==
					"中止并关闭 · Abort and close"
			)
				return;
			await call("sessions.close", { id: info.session.id });
			reset();
			target = {};
			title();
			return;
		}
		if (/^(model|effort|status|bg|compact)(?:\s|$)/.test(name)) {
			if (!info) throw new Error("请先选择会话");
			notice(await call<string>("sessions.command", { id: info.session.id, command: name }));
			await refresh();
			return;
		}
		if (name === "session") {
			if (info) await refresh();
			footer.setExpanded(!footer.expanded);
			render();
			return;
		}
		if (name === "skills") {
			if (!info) throw new Error("请先选择实际会话 / Select a session first");
			const ids = [...new Set([...observers.keys(), ...disconnected])];
			const id = ids.length > 1 ? await choose("查看会话技能 / Session skills", ids) : info.session.id;
			if (!id) return;
			const epoch = viewEpoch;
			const selected = await call<Info>("terminal.info", { id });
			if (epoch !== viewEpoch) return;
			notice(
				selected.skills.skills.map((skill) => `${skill.name} · ${skill.description}`).join("\n") ||
					"无技能 / No skills",
			);
			return;
		}
		if (name === "hotkeys") {
			helpVisible = !helpVisible;
			showHelp();
			return;
		}
		if (name === "help") {
			chat.addChild(
				new Markdown(
					chatCommands.map((item) => `- /${item.name} — ${item.description}`).join("\n"),
					1,
					0,
					getMarkdownTheme(),
				),
			);
			render();
			return;
		}
		throw new Error(`未知命令 / Unknown command: /${name}`);
	};
	const submit = async (text: string, busy: "steer" | "followup") => {
		if (disconnected.size) {
			await Promise.all([...disconnected].map(watch));
			throw new Error(
				"观察连接已恢复；请核对历史后再次提交，未自动重发 / Reconnected; inspect history before submitting again",
			);
		}
		if (target.channel) {
			if (!channelSocket || channelSocket.destroyed) throw new Error("渠道未连接 / Channel disconnected");
			channelSocket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
			return;
		}
		if (!info) {
			opening ??= (async () => {
				const epoch = viewEpoch;
				const session = await call<SessionInfo>("sessions.open", {
					preset: target.preset ?? "default",
					close: "manual",
				});
				if (epoch !== viewEpoch) throw new Error(`已创建会话 ${session.id}，当前目标已切换；未提交输入`);
				target = { session: session.id };
				await watch(session.id);
			})();
			try {
				await opening;
			} finally {
				opening = undefined;
			}
		}
		if (info?.session.mode !== "task" || info.session.closed || info.session.close !== "manual")
			throw new Error("该历史只读；请 /new 新建任务 / Read-only history; use /new");
		let result: { event: string };
		try {
			result = await call<{ event: string }>("sessions.submit", { id: info.session.id, text, busy });
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code === "ECONNRESET" ||
				(error instanceof Error && error.message.includes("without a response"))
			)
				throw new Error(
					"接纳状态未知，请先查看会话历史再决定是否重发 / Acceptance unknown; inspect history before resending",
				);
			throw error;
		}

		void result;
	};
	const onSubmit = (text: string, busy: "steer" | "followup") => {
		if (!text.trim()) return;
		if (text === "?") {
			editor.setText("");
			helpVisible = true;
			showHelp();
			return;
		}
		editor.setText("");
		guarded(async () => {
			try {
				if (text.startsWith("/") && chatCommands.some((item) => item.name === text.slice(1).split(/\s/, 1)[0]))
					await command(text);
				else {
					await submit(text.startsWith("//") ? text.slice(1) : text, busy);
					editor.addToHistory(text);
				}
			} catch (error) {
				editor.setText(text);
				throw error;
			}
		});
	};
	editor.onSubmit = (text) => onSubmit(text, "steer");
	editor.onAction("app.message.dequeue", () =>
		guarded(async () => {
			if (!info || target.channel) return;
			const items = await call<Array<{ text: string }>>("terminal.dequeue", { id: info.session.id });
			if (items.length)
				editor.setText([...items.map((item) => item.text), editor.getText()].filter(Boolean).join("\n\n"));
			render();
		}),
	);
	editor.onAction("app.message.followUp", () => onSubmit(editor.getText(), "followup"));
	editor.onChange = (text) => {
		helpVisible = text === "?";
		showHelp();
	};
	editor.onEscape = () => {
		if (helpVisible) {
			helpVisible = false;
			if (editor.getText() === "?") editor.setText("");
			showHelp();
		} else guarded(stop);
	};
	const leave = () => {
		if (!closed) {
			closed = true;
			finish();
		}
	};
	editor.onCtrlD = leave;
	editor.onAction("app.clear", () => {
		if (running) {
			guarded(stop);
			return;
		}
		const now = Date.now();
		if (now - clearPressedAt < 500) leave();
		else {
			editor.setText("");
			clearPressedAt = now;
		}
		render();
	});
	editor.onAction("app.tools.expand", () => {
		toolsExpanded = !footer.expanded;
		footer.setExpanded(toolsExpanded);
		hideThinking = !toolsExpanded;
		for (const assistant of assistants) assistant.setHideThinkingBlock(hideThinking);
		for (const tool of tools.values()) tool.setExpanded(toolsExpanded);
		render();
	});
	editor.onExtensionShortcut = (data) => {
		if (data === "\x0c") {
			ui.requestRender(true);
			return true;
		}
		return false;
	};
	editor.onAction("app.message.copy", () =>
		guarded(async () => {
			if (lastAssistantText) await copyToClipboard(lastAssistantText);
		}),
	);
	editor.onAction("app.editor.external", () =>
		guarded(async () => {
			const content = editor.getExpandedText?.() ?? editor.getText();
			ui.stop();
			try {
				const result = await editInExternalEditor({
					command: process.env.VISUAL || process.env.EDITOR || "nano",
					content,
				});
				if (result.status === "complete") editor.setText(result.content);
			} finally {
				if (!closed) {
					ui.start();
					ui.requestRender(true);
				}
			}
		}),
	);

	autocomplete();
	title();
	try {
		// Verify the home/service before entering raw mode. No model call on entry.
		presets = await call<Presets>("terminal.presets");
		title();
		ui.start();
		await syncTerminalTheme(ui, () => {
			theme = nativeTheme.theme;
			ui.invalidate();
			title();
			showHelp();
		});
		if (initial.channel) await enterChannel(initial.channel);
		else if (initial.session) await watch(initial.session);
		else if (!presets.some((preset) => preset.id === (initial.preset ?? "default"))) await newTask();
		await done;
	} finally {
		disconnect();
		loader?.dispose();
		ui.stop();
		if (running && info)
			process.stdout.write(
				`任务仍在运行 / Task continues. yonder chat --session ${info.session.id} --home ${JSON.stringify(home)}\n`,
			);
	}
}
