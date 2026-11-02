import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import {
	ExtensionSelectorComponent,
	getMarkdownTheme,
	SessionSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { cliChannelEndpoint, type Kernel } from "@yonder/local-host";
import { chatCommands, type SessionInfo, type YEvent } from "@yonder/sdk";
import { branchCommand } from "./branch-commands.js";
import type { Channels, Info, Input, Presets, TerminalRuntime, View } from "./terminal-context.js";
import { sameDirectory } from "./terminal-support.js";

/** Input layer: slash commands, submissions, session and channel switching. */
export function createInput(rt: TerminalRuntime, view: View): Input {
	const { editor, ui, keys, chat } = rt;
	const closeModal = () => {
		if (rt.modal) {
			rt.editorContainer.clear();
			rt.editorContainer.addChild(editor);
			rt.modal = undefined;
			ui.setFocus(editor);
			view.render();
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
			rt.modal = selector;
			rt.editorContainer.clear();
			rt.editorContainer.addChild(selector);
			ui.setFocus(selector);
			view.render();
		});
	const newTask = async () => {
		rt.presets = await rt.call<Presets>("terminal.presets");
		const labels = rt.presets.map((item) => `${item.id} · ${item.description}`);
		const selected = await choose("新建会话 · New session", labels);
		if (!selected) return;
		const preset = rt.presets[labels.indexOf(selected)];
		if (!preset) return;
		view.reset();
		rt.target = { preset: preset.id };
		view.title();
		view.autocomplete();
	};
	const resume = async () => {
		const loader = async (currentOnly = false) =>
			(await rt.call<Awaited<ReturnType<Kernel["terminal"]["list"]>>>("terminal.sessions"))
				.filter((row) => !currentOnly || sameDirectory(row.cwd, rt.info?.config.cwd ?? rt.home))
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
				view.guarded(async () => {
					view.reset();
					rt.target = { session: id };
					await view.watch(id);
				});
			},
			closeModal,
			closeModal,
			view.render,
			{ keybindings: keys, showRenameHint: false },
			rt.info?.session.id,
		);
		selector.getSessionList().onDeleteSession = async () => {
			view.notice("请使用 /close 关闭任务；历史保留 / Use /close; history is retained", true);
		};
		rt.modal = selector;
		rt.editorContainer.clear();
		rt.editorContainer.addChild(selector);
		ui.setFocus(selector);
		view.render();
	};
	const enterChannel = async (id: string) => {
		view.reset();
		rt.target = { channel: id };
		view.title();
		view.autocomplete();
		const socket = createConnection(cliChannelEndpoint(rt.home, id));
		rt.channelSocket = socket;
		socket.setEncoding("utf8");
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		lines.on("line", (line) => {
			if (rt.channelSocket !== socket) return;
			try {
				const packet = JSON.parse(line) as { type: string; event?: YEvent; message?: string };
				if (packet.type === "accepted" && packet.event) {
					const routes = packet.event.routes ?? [];
					for (const route of routes) if (route.session) rt.speakers.set(route.session, route.agent);
					for (const route of routes)
						if (route.session)
							view.guarded(async () => {
								await view.watch(route.session as string);
							});
					if (!routes.some((route) => route.wake === "run"))
						view.notice(
							`输入已接纳，未唤醒模型 / Accepted without running: ${routes.map((route) => `${route.agent}: ${route.dropped ?? route.wake}`).join(", ")}`,
						);
				} else if (packet.type === "error") view.notice(packet.message ?? "Channel error", true);
			} catch (error) {
				view.notice(String(error), true);
			}
		});
		socket.on("error", (error) => view.notice(error.message, true));
		socket.on("close", () => {
			if (!rt.closed && rt.channelSocket === socket) view.notice("渠道连接已断开 / Channel disconnected", true);
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		const channel = (await rt.call<Channels>("terminal.channels")).find((channel) => channel.id === id);
		const mains = await rt.call<SessionInfo[]>("sessions.list", { filter: { mode: "main", open: true } });
		for (const session of mains)
			if (channel?.agents.some((agent) => agent.id === session.agent && agent.main)) {
				rt.speakers.set(
					session.id,
					channel.agents.find((agent) => agent.id === session.agent)?.name ?? session.agent ?? "",
				);
				await view.watch(session.id);
			}
	};
	const stop = async () => {
		const ids = [...rt.observers.keys()];
		if (!ids.length) return;
		const id =
			ids.length === 1 ? ids[0] : await choose("中止整个会话及排队输入 · Abort session and queued inputs", ids);
		if (id) {
			if (!rt.target.channel) {
				const withdrawn = await rt.call<Array<{ text: string }>>("terminal.dequeue", { id });
				if (withdrawn.length)
					editor.setText([...withdrawn.map((item) => item.text), editor.getText()].filter(Boolean).join("\n\n"));
			}
			await rt.call("sessions.abort", { id });
		}
	};
	const command = async (line: string) => {
		const name = line.slice(1).trim();
		if (name === "new") return newTask();
		if (name === "resume") return resume();
		if (name === "tree" || /^fork(?:\s+\d+)?$/.test(name)) {
			if (!rt.info || rt.target.channel) throw new Error("请先选择独立任务 / Select a standalone task");
			return branchCommand(
				name,
				rt.info.session.id,
				rt.call,
				choose,
				async (id) => {
					view.reset();
					rt.target = { session: id };
					await view.watch(id);
				},
				view.notice,
			);
		}
		if (name === "channel") {
			const channels = await rt.call<Channels>("terminal.channels");
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
			const result = await rt.call<{ instance: string; status: string; qrcodeUrl?: string }>(
				"channels.login",
				instance ? { instance } : {},
			);
			view.notice(
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
			if (rt.info?.session.mode !== "task" || rt.info.session.close !== "manual" || rt.target.channel)
				throw new Error("仅可关闭独立任务 / Only standalone tasks can be closed");
			if (
				rt.running &&
				(await choose("中止并关闭？ · Abort and close?", ["返回 · Back", "中止并关闭 · Abort and close"])) !==
					"中止并关闭 · Abort and close"
			)
				return;
			await rt.call("sessions.close", { id: rt.info.session.id });
			view.reset();
			rt.target = {};
			view.title();
			return;
		}
		if (/^(model|effort|status|bg|compact)(?:\s|$)/.test(name)) {
			if (!rt.info) throw new Error("请先选择会话");
			view.notice(await rt.call<string>("sessions.command", { id: rt.info.session.id, command: name }));
			await view.refresh();
			return;
		}
		if (name === "session") {
			if (rt.info) await view.refresh();
			rt.footer.setExpanded(!rt.footer.expanded);
			view.render();
			return;
		}
		if (name === "skills") {
			if (!rt.info) throw new Error("请先选择实际会话 / Select a session first");
			const ids = [...new Set([...rt.observers.keys(), ...rt.disconnected])];
			const id = ids.length > 1 ? await choose("查看会话技能 / Session skills", ids) : rt.info.session.id;
			if (!id) return;
			const epoch = rt.viewEpoch;
			const selected = await rt.call<Info>("terminal.info", { id });
			if (epoch !== rt.viewEpoch) return;
			view.notice(
				selected.skills.skills.map((skill) => `${skill.name} · ${skill.description}`).join("\n") ||
					"无技能 / No skills",
			);
			return;
		}
		if (name === "hotkeys") {
			rt.helpVisible = !rt.helpVisible;
			view.showHelp();
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
			view.render();
			return;
		}
		throw new Error(`未知命令 / Unknown command: /${name}`);
	};
	const submit = async (text: string, busy: "steer" | "followup") => {
		if (rt.disconnected.size) {
			await Promise.all([...rt.disconnected].map(view.watch));
			throw new Error(
				"观察连接已恢复；请核对历史后再次提交，未自动重发 / Reconnected; inspect history before submitting again",
			);
		}
		if (rt.target.channel) {
			if (!rt.channelSocket || rt.channelSocket.destroyed) throw new Error("渠道未连接 / Channel disconnected");
			rt.channelSocket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
			return;
		}
		if (!rt.info) {
			rt.opening ??= (async () => {
				const epoch = rt.viewEpoch;
				const session = await rt.call<SessionInfo>("sessions.open", {
					preset: rt.target.preset ?? "default",
					close: "manual",
				});
				if (epoch !== rt.viewEpoch) throw new Error(`已创建会话 ${session.id}，当前目标已切换；未提交输入`);
				rt.target = { session: session.id };
				await view.watch(session.id);
			})();
			try {
				await rt.opening;
			} finally {
				rt.opening = undefined;
			}
		}
		const info = rt.info;
		if (!info) throw new Error("请先选择会话 / Select a session first");
		if (info.session.mode !== "task" || info.session.closed || info.session.close !== "manual")
			throw new Error("该历史只读；请 /new 新建任务 / Read-only history; use /new");
		let result: { event: string };
		try {
			result = await rt.call<{ event: string }>("sessions.submit", { id: info.session.id, text, busy });
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
			rt.helpVisible = true;
			view.showHelp();
			return;
		}
		editor.setText("");
		view.guarded(async () => {
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
	const leave = () => {
		if (!rt.closed) {
			rt.closed = true;
			rt.finish();
		}
	};
	return { closeModal, choose, newTask, resume, enterChannel, stop, command, submit, onSubmit, leave };
}
