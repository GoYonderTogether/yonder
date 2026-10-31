import { join } from "node:path";
import { CustomEditor, copyToClipboard } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, setKeybindings } from "@earendil-works/pi-tui";
import { requestControl } from "@yonder/core";
import { chatCommands } from "@yonder/sdk";
import {
	createChatViewport,
	createInteractiveTui,
	editInExternalEditor,
	KeybindingsManager,
	nativeTheme,
	syncTerminalTheme,
} from "./pi-native.js";
import type { TerminalRuntime } from "./terminal-context.js";
import { createInput } from "./terminal-input.js";
import type { ChatTarget } from "./terminal-support.js";
import { createView } from "./terminal-view.js";
import { FooterComponent, type FooterView } from "./vendor/pi-footer.js";

export { type ChatTarget, hideReplyMarker, sameDirectory } from "./terminal-support.js";

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
	let finish!: () => void;
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const footerView = (): FooterView => view.footerView();
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
		scrollbarTrackStyle: (text) => rt.theme.fg("scrollbarTrack", text),
		scrollbarThumbStyle: (text) => rt.theme.fg("scrollbarThumb", text),
	});
	for (const child of [document, pending, status, above, editorContainer, below, footerContainer]) ui.addChild(child);
	ui.setLayoutRoot(viewport.root);
	ui.setFocus(editor);
	const rt: TerminalRuntime = {
		home,
		keys,
		ui,
		theme: nativeTheme.theme,
		document,
		header,
		chat,
		pending,
		status,
		above,
		below,
		editor,
		editorContainer,
		footer,
		footerContainer,
		info: undefined,
		opening: undefined,
		presets: [],
		target: { ...initial },
		running: false,
		closed: false,
		toolsExpanded: false,
		hideThinking: true,
		helpVisible: false,
		clearPressedAt: 0,
		loader: undefined,
		channelSocket: undefined,
		observers: new Map(),
		disconnected: new Set(),
		watching: new Map(),
		viewEpoch: 0,
		entries: new Map(),
		live: new Map(),
		tools: new Map(),
		assistants: new Set(),
		activeSessions: new Set(),
		speakers: new Map(),
		lastAssistantText: "",
		modal: undefined,
		finish,
		call: <T>(method: string, params?: object): Promise<T> =>
			requestControl(home, { method, ...(params ? { params } : {}) }) as Promise<T>,
	};
	const view = createView(rt);
	const input = createInput(rt, view);
	editor.onSubmit = (text) => input.onSubmit(text, "steer");
	editor.onAction("app.message.dequeue", () =>
		view.guarded(async () => {
			if (!rt.info || rt.target.channel) return;
			const items = await rt.call<Array<{ text: string }>>("terminal.dequeue", { id: rt.info.session.id });
			if (items.length)
				editor.setText([...items.map((item) => item.text), editor.getText()].filter(Boolean).join("\n\n"));
			view.render();
		}),
	);
	editor.onAction("app.message.followUp", () => input.onSubmit(editor.getText(), "followup"));
	editor.onChange = (text) => {
		rt.helpVisible = text === "?";
		view.showHelp();
	};
	editor.onEscape = () => {
		if (rt.helpVisible) {
			rt.helpVisible = false;
			if (editor.getText() === "?") editor.setText("");
			view.showHelp();
		} else view.guarded(input.stop);
	};
	editor.onCtrlD = input.leave;
	editor.onAction("app.clear", () => {
		if (rt.running) {
			view.guarded(input.stop);
			return;
		}
		const now = Date.now();
		if (now - rt.clearPressedAt < 500) input.leave();
		else {
			editor.setText("");
			rt.clearPressedAt = now;
		}
		view.render();
	});
	editor.onAction("app.tools.expand", () => {
		rt.toolsExpanded = !footer.expanded;
		footer.setExpanded(rt.toolsExpanded);
		rt.hideThinking = !rt.toolsExpanded;
		for (const assistant of rt.assistants) assistant.setHideThinkingBlock(rt.hideThinking);
		for (const tool of rt.tools.values()) tool.setExpanded(rt.toolsExpanded);
		view.render();
	});
	editor.onExtensionShortcut = (data) => {
		if (data === "\x0c") {
			ui.requestRender(true);
			return true;
		}
		return false;
	};
	editor.onAction("app.message.copy", () =>
		view.guarded(async () => {
			if (rt.lastAssistantText) await copyToClipboard(rt.lastAssistantText);
		}),
	);
	editor.onAction("app.editor.external", () =>
		view.guarded(async () => {
			const content = editor.getExpandedText?.() ?? editor.getText();
			ui.stop();
			try {
				const result = await editInExternalEditor({
					command: process.env.VISUAL || process.env.EDITOR || "nano",
					content,
				});
				if (result.status === "complete") editor.setText(result.content);
			} finally {
				if (!rt.closed) {
					ui.start();
					ui.requestRender(true);
				}
			}
		}),
	);

	view.autocomplete();
	view.title();
	try {
		// Verify the home/service before entering raw mode. No model call on entry.
		rt.presets = await rt.call("terminal.presets");
		view.title();
		ui.start();
		await syncTerminalTheme(ui, () => {
			rt.theme = nativeTheme.theme;
			ui.invalidate();
			view.title();
			view.showHelp();
		});
		if (initial.channel) await input.enterChannel(initial.channel);
		else if (initial.session) await view.watch(initial.session);
		else if (!rt.presets.some((preset) => preset.id === (initial.preset ?? "default"))) await input.newTask();
		await done;
	} finally {
		view.disconnect();
		rt.loader?.dispose();
		ui.stop();
		if (rt.running && rt.info)
			process.stdout.write(
				`任务仍在运行 / Task continues. yonder chat --session ${rt.info.session.id} --home ${JSON.stringify(home)}\n`,
			);
	}
}
