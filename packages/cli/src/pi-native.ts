import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type CustomEditor, initTheme, type Theme, type ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, ScrollView, TUI, TuiAltScreen } from "@earendil-works/pi-tui";

// Pinned pi-coding-agent 1.3.0 UI modules; no AgentSession or SessionManager is constructed.
const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
initTheme(undefined, false);
export const nativeTheme = (await load("modes/interactive/theme/theme.js")) as {
	theme: Theme;
	getEditorTheme(): EditorTheme;
};
export type NativeKeys = ConstructorParameters<typeof CustomEditor>[2];
export const { KeybindingsManager } = (await load("core/keybindings.js")) as {
	KeybindingsManager: new () => NativeKeys;
};
export const { createInteractiveTui } = (await load("modes/interactive/tui-renderer.js")) as {
	createInteractiveTui(options: {
		tuiMode: "fullscreen";
		showHardwareCursor: boolean;
		logDirectory: string;
	}): TuiAltScreen;
};
export const { createChatViewport } = (await load("modes/interactive/chat-viewport.js")) as {
	createChatViewport(options: {
		document: Component;
		pendingMessages: Component;
		status: Component;
		editor: Component;
		footer: Component;
		widgetsAbove?: Component;
		widgetsBelow?: Component;
		scrollbarTrackStyle?: (text: string) => string;
		scrollbarThumbStyle?: (text: string) => string;
	}): { root: Component; transcript: ScrollView };
};
export const { WorkingStatusIndicator } = (await load("modes/interactive/components/status-indicator.js")) as {
	WorkingStatusIndicator: new (
		ui: TUI,
		message: string,
	) => NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>;
};

export const { withBuiltInRenderers } = (await load("core/tools/renderers/index.js")) as {
	withBuiltInRenderers(name: string, definition?: undefined): ConstructorParameters<typeof ToolExecutionComponent>[4];
};
