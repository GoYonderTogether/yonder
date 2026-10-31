import type { Socket } from "node:net";
import type {
	AssistantMessageComponent,
	CustomEditor,
	ExtensionSelectorComponent,
	SessionSelectorComponent,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, Container } from "@earendil-works/pi-tui";
import type { Kernel, TerminalUpdate } from "@yonder/core";
import type { SessionNotification, YEvent } from "@yonder/sdk";
import type { CompactToolExecution } from "./message-presentation.js";
import type { createInteractiveTui, KeybindingsManager, WorkingStatusIndicator } from "./pi-native.js";
import type { ChatTarget, Message } from "./terminal-support.js";
import type { FooterComponent, FooterView } from "./vendor/pi-footer.js";

export type Info = Awaited<ReturnType<Kernel["terminal"]["info"]>>;
export type Presets = ReturnType<Kernel["terminal"]["presets"]>;
export type Channels = ReturnType<Kernel["terminal"]["channels"]>;

/** Mutable per-run terminal state shared by the rendering and input layers. */
export interface TerminalRuntime {
	readonly home: string;
	readonly keys: InstanceType<typeof KeybindingsManager>;
	readonly ui: ReturnType<typeof createInteractiveTui>;
	theme: Theme;
	readonly document: Container;
	readonly header: Container;
	readonly chat: Container;
	readonly pending: Container;
	readonly status: Container;
	readonly above: Container;
	readonly below: Container;
	readonly editor: CustomEditor;
	readonly editorContainer: Container;
	readonly footer: FooterComponent;
	readonly footerContainer: Container;
	info: Info | undefined;
	opening: Promise<void> | undefined;
	presets: Presets;
	target: ChatTarget;
	running: boolean;
	closed: boolean;
	toolsExpanded: boolean;
	hideThinking: boolean;
	helpVisible: boolean;
	clearPressedAt: number;
	loader: InstanceType<typeof WorkingStatusIndicator> | undefined;
	channelSocket: Socket | undefined;
	readonly observers: Map<string, { close(): void }>;
	readonly disconnected: Set<string>;
	readonly watching: Map<string, Promise<void>>;
	viewEpoch: number;
	readonly entries: Map<string, Component>;
	readonly live: Map<string, AssistantMessageComponent>;
	readonly tools: Map<string, CompactToolExecution>;
	readonly assistants: Set<AssistantMessageComponent>;
	readonly activeSessions: Set<string>;
	readonly speakers: Map<string, string>;
	lastAssistantText: string;
	modal: Component | undefined;
	finish: () => void;
	call: <T>(method: string, params?: object) => Promise<T>;
}

/** Rendering layer: pi component tree updates for one shared terminal state. */
export interface View {
	render(): void;
	notice(text: string, error?: boolean): void;
	setRunning(value: boolean, session?: string): void;
	guarded(action: () => Promise<void>): void;
	showHelp(): void;
	title(): void;
	autocomplete(): void;
	refresh(id?: string): Promise<void>;
	footerView(): FooterView;
	toolComponent(session: string, id: string, name: string, args?: object): CompactToolExecution;
	showMessage(session: string, id: string, value: object, streaming?: boolean): void;
	showNotification(session: string, value: SessionNotification): void;
	receive(session: string, packet: unknown): void;
	watch(id: string): Promise<void>;
	disconnect(): void;
	reset(): void;
}

/** Input layer: slash commands, submissions, session/channel switching. */
export interface Input {
	closeModal(): void;
	choose(heading: string, options: string[]): Promise<string | undefined>;
	newTask(): Promise<void>;
	resume(): Promise<void>;
	enterChannel(id: string): Promise<void>;
	stop(): Promise<void>;
	leave(): void;
	command(line: string): Promise<void>;
	submit(text: string, busy: "steer" | "followup"): Promise<void>;
	onSubmit(text: string, busy: "steer" | "followup"): void;
}

export type { ExtensionSelectorComponent, Message, SessionSelectorComponent, TerminalUpdate, YEvent };
