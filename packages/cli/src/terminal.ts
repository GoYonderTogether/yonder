import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	AssistantMessageComponent,
	CustomEditor,
	ExtensionEditorComponent,
	ExtensionSelectorComponent,
	getMarkdownTheme,
	SessionSelectorComponent,
	type Theme,
	ToolExecutionComponent,
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
import { type Kernel, observeControl, packageVersion, requestControl, type TerminalUpdate } from "@yonder/core";
import type { SessionInfo, YEvent } from "@yonder/sdk";
import { CommandAutocomplete } from "./autocomplete.js";
import {
	createChatViewport,
	createInteractiveTui,
	KeybindingsManager,
	nativeTheme,
	WorkingStatusIndicator,
	withBuiltInRenderers,
} from "./pi-native.js";
import { FooterComponent, type FooterView } from "./vendor/pi-footer.js";

export interface ChatTarget {
	preset?: string;
	session?: string;
	channel?: string;
}
type Info = Awaited<ReturnType<Kernel["terminal"]["info"]>>;
type Presets = ReturnType<Kernel["terminal"]["presets"]>;
type Channels = ReturnType<Kernel["terminal"]["channels"]>;
type Assistant = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;
type Message =
	| Assistant
	| { role: "user"; content: string | Array<{ type: string; text?: string }> }
	| {
			role: "toolResult";
			toolCallId: string;
			toolName: string;
			content: Array<{ type: string; text?: string }>;
			isError: boolean;
	  };

export const chatCommands = [
	{ name: "new", description: "新建会话 · New session" },
	{ name: "resume", description: "继续会话 · Resume session" },
	{ name: "session", description: "当前会话 · Session info" },
	{ name: "hotkeys", description: "快捷键 · Hotkeys" },
	{ name: "channel", description: "渠道聊天 · Channel chat" },
	{ name: "skills", description: "技能 · Skills" },
	{ name: "stop", description: "中止运行 · Stop" },
	{ name: "close", description: "关闭任务 · Close task" },
	{ name: "help", description: "帮助 · Help" },
];

/** Native pi 1.3.0 component tree and actions; only target and transport belong to Yonder. */
export async function runTerminal(home: string, initial: ChatTarget = {}) {
	const keys = new KeybindingsManager();
	setKeybindings(keys);
	const ui = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: join(home, ".yonder/logs"),
	});
	const theme: Theme = nativeTheme.theme;
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
	let presets: Presets = [];
	let target = { ...initial };
	let running = false,
		closed = false,
		toolsExpanded = false,
		hideThinking = false,
		clearPressedAt = 0;
	let loader: InstanceType<typeof WorkingStatusIndicator> | undefined;
	let channelSocket: Socket | undefined;
	const observers = new Map<string, { close(): void }>();
	const entries = new Map<string, Component>();
	const live = new Map<string, AssistantMessageComponent>();
	const tools = new Map<string, ToolExecutionComponent>();
	const assistants = new Set<AssistantMessageComponent>();
	const activeSessions = new Set<string>();
	const speakers = new Map<string, string>();
	let lastSpeaker: string | undefined;
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
				? `${info.session.agent ?? "独立任务 / Standalone task"} · #${info.session.id} · ${info.session.profile}`
				: target.channel
					? `渠道 / Channel ${target.channel}`
					: `新任务 / New task · ${target.preset ?? "default"}`,
			...(model ? { model } : {}),
			...(info?.config.resolved.thinking ? { thinkingLevel: info.config.resolved.thinking } : {}),
			usageTotals: info?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			contextUsage: {
				contextWindow:
					info?.model?.contextWindow ??
					presets.find((item) => item.id === (target.preset ?? "default"))?.modelInfo?.contextWindow ??
					0,
				percent: null,
			},
			status: `${running ? "运行中 / Working" : "就绪 / Ready"}${info ? ` · ${info.config.resolved.level ?? info.config.resolved.capabilities.join(",")} · ${info.config.resolved.env}` : ""}`,
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
	const title = () => {
		header.clear();
		header.addChild(
			new Text(theme.bold(theme.fg("accent", "Yonder Harness")) + theme.fg("dim", ` v${packageVersion}`), 1, 0),
		);
		header.addChild(new Text(theme.fg("dim", footerView().label), 1, 0));
		header.addChild(new Spacer(1));
		render();
	};
	const autocomplete = () =>
		editor.setAutocompleteProvider(new CommandAutocomplete(chatCommands, info?.config.cwd ?? home));
	const refresh = async (id = info?.session.id) => {
		if (id) {
			info = await call<Info>("terminal.info", { id });
			title();
			autocomplete();
			editor.borderColor = theme.getThinkingBorderColor(info.config.resolved.thinking);
		}
	};
	const toolComponent = (session: string, id: string, name: string, args: object = {}) => {
		const key = `${session}:${id}`;
		let tool = tools.get(key);
		if (!tool) {
			tool = new ToolExecutionComponent(
				name,
				id,
				args,
				{ outputPad: 1 },
				withBuiltInRenderers(name),
				ui,
				info?.config.cwd ?? home,
			);
			tool.setExpanded(toolsExpanded);
			tools.set(key, tool);
			chat.addChild(tool);
		}
		return tool;
	};
	const showMessage = (session: string, id: string, value: object, streaming = false) => {
		const message = value as Message;
		if (target.channel && message.role === "assistant" && lastSpeaker !== session) {
			notice(`${speakers.get(session) ?? "session"} · #${session}`);
			lastSpeaker = session;
		}
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
				1,
			);
			entries.set(key, component);
			chat.addChild(component);
		} else if (message.role === "assistant") {
			let component = entries.get(key) as AssistantMessageComponent | undefined;
			if (!component && id !== "live") {
				component = live.get(session);
				if (component) live.delete(session);
			}
			if (!component) {
				component = new AssistantMessageComponent(message, hideThinking, getMarkdownTheme(), undefined, 1);
				assistants.add(component);
				chat.addChild(component);
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
	const receive = (session: string, packet: unknown) => {
		const envelope = packet as { type: string; update?: TerminalUpdate; error?: string };
		if (envelope.type === "disconnected") {
			notice(`连接已断开 / Disconnected: ${envelope.error}. yonder chat --session ${session}`, true);
			return;
		}
		const update = envelope.update;
		if (!update) return;
		if (update.type === "snapshot") {
			for (const item of update.messages ?? []) showMessage(session, item.id, item.message);
			setRunning(update.running ?? false, session);
		} else if (update.type === "message" && update.message)
			showMessage(session, update.id ?? "live", update.message, update.streaming);
		else if (update.type === "tool" && update.tool) {
			const item = update.tool,
				tool = toolComponent(session, item.id, item.name, item.args);
			if (item.phase === "start") {
				tool.updateArgs(item.args ?? {});
				tool.setArgsComplete();
				tool.markExecutionStarted();
			}
			if (item.result) tool.updateResult(item.result as Parameters<ToolExecutionComponent["updateResult"]>[0]);
			else if (item.phase === "update")
				tool.updateResult({ content: [{ type: "text", text: item.text ?? "" }], isError: false }, true);
			else if (item.phase === "end") notice(`${item.name}: 结果未知 / Result unavailable`, true);
			render();
		} else if (update.type === "state") setRunning(update.running ?? false, session);
		else if (update.type === "inbox") {
			guarded(async () => {
				const items = await call<Array<{ mode: string; text: string }>>("terminal.queued", { id: session });
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
	const watch = async (id: string) => {
		if (observers.has(id)) return;
		const observation = await observeControl(home, { method: "sessions.watch", params: { id } }, (value) =>
			receive(id, value),
		);
		observers.set(id, observation);
		info = observation.result as Info;
		title();
		autocomplete();
	};
	const disconnect = () => {
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
		const rows = await call<SessionInfo[]>("sessions.list", { filter: {} });
		const loader = async () =>
			Promise.all(
				rows.map(async (row) => {
					const data = await call<{ transcript: Array<{ text: string }> }>("sessions.show", { id: row.id });
					return {
						path: row.id,
						id: row.id,
						cwd: home,
						name: `${row.agent ?? "独立任务"} · ${row.profile}${row.closed ? " · 已关闭/Closed" : ""}`,
						created: new Date(row.opened),
						modified: new Date(row.closed ?? row.opened),
						messageCount: data.transcript.length,
						firstMessage: data.transcript[0]?.text ?? "",
						allMessagesText: data.transcript.map((item) => item.text).join("\n"),
					};
				}),
			);
		const selector = new SessionSelectorComponent(
			loader,
			loader,
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
		const socket = createConnection(join(home, ".yonder/plugins/channel-cli", `${id}.sock`));
		channelSocket = socket;
		socket.setEncoding("utf8");
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		lines.on("line", (line) => {
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
	};
	const stop = async () => {
		const ids = [...observers.keys()];
		if (!ids.length) return;
		const id =
			ids.length === 1 ? ids[0] : await choose("中止整个会话及排队输入 · Abort session and queued inputs", ids);
		if (id) await call("sessions.abort", { id });
	};
	const command = async (line: string) => {
		const name = line.slice(1).trim();
		if (name === "new") return newTask();
		if (name === "resume") return resume();
		if (name === "channel") {
			const channels = await call<Channels>("terminal.channels");
			const labels = channels.map(
				(channel) => `${channel.id} · ${channel.agents.map((agent) => agent.name).join(", ") || "无绑定/Unbound"}`,
			);
			const selected = await choose("渠道聊天 · Channel chat", labels);
			const channel = selected ? channels[labels.indexOf(selected)] : undefined;
			if (channel) await enterChannel(channel.id);
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
		if (name === "session") {
			if (info) {
				await refresh();
				notice(
					JSON.stringify(
						{
							session: info.session,
							model: info.config.resolved.model,
							capabilities: info.config.resolved.capabilities,
							cwd: info.config.cwd,
							env: info.config.resolved.env,
						},
						null,
						2,
					),
				);
			} else notice(footerView().label);
			return;
		}
		if (name === "skills") {
			if (!info) throw new Error("请先选择实际会话 / Select a session first");
			await refresh();
			notice(
				info.skills.skills.map((skill) => `${skill.name} · ${skill.description}`).join("\n") || "无技能 / No skills",
			);
			return;
		}
		if (name === "hotkeys") {
			notice(
				(
					[
						"tui.input.submit",
						"tui.input.newLine",
						"tui.input.tab",
						"app.interrupt",
						"app.clear",
						"app.exit",
						"app.tools.expand",
						"app.message.followUp",
					] as const
				)
					.map((action) => `${keys.getKeys(action).join("/")} · ${keys.getDefinition(action).description}`)
					.join("\n"),
			);
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
		if (target.channel) {
			if (!channelSocket || channelSocket.destroyed) throw new Error("渠道未连接 / Channel disconnected");
			channelSocket.write(`${text}\n`);
			return;
		}
		if (!info) {
			const session = await call<SessionInfo>("sessions.open", { preset: target.preset ?? "default", close: "manual" });
			target = { session: session.id };
			await watch(session.id);
		}
		if (info?.session.mode !== "task" || info.session.closed || info.session.close !== "manual")
			throw new Error("该历史只读；请 /new 新建任务 / Read-only history; use /new");
		const result = await call<{ event: string }>("sessions.submit", { id: info.session.id, text, busy });

		void result;
	};
	const onSubmit = (text: string, busy: "steer" | "followup") => {
		if (!text.trim()) return;
		editor.setText("");
		guarded(async () => {
			try {
				if (text.startsWith("/") && !text.startsWith("//")) await command(text);
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
	editor.onEscape = () => guarded(stop);
	const leave = () => {
		if (!closed) {
			closed = true;
			finish();
		}
	};
	editor.onCtrlD = leave;
	editor.onAction("app.clear", () => {
		const now = Date.now();
		if (now - clearPressedAt < 500) leave();
		else {
			editor.setText("");
			clearPressedAt = now;
		}
		render();
	});
	editor.onAction("app.tools.expand", () => {
		toolsExpanded = !toolsExpanded;
		for (const tool of tools.values()) tool.setExpanded(toolsExpanded);
		render();
	});
	editor.onAction("app.thinking.toggle", () => {
		hideThinking = !hideThinking;
		for (const assistant of assistants) assistant.setHideThinkingBlock(hideThinking);
		render();
	});
	editor.onAction("app.editor.external", () => {
		const external = new ExtensionEditorComponent(
			ui,
			keys,
			"编辑消息 · Edit message",
			editor.getText(),
			(value) => {
				closeModal();
				editor.setText(value);
				render();
			},
			closeModal,
		);
		modal = external;
		editorContainer.clear();
		editorContainer.addChild(external);
		ui.setFocus(external);
		render();
	});
	autocomplete();
	title();
	try {
		// Verify the home/service before entering raw mode. No model call on entry.
		presets = await call<Presets>("terminal.presets");
		title();
		ui.start();
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
