/** Yonder's database view, shared by local and remote runtime hosts. */
export type DbValue = null | number | bigint | string | Uint8Array;
export interface DbExecutor {
	exec(sql: string): Promise<void>;
	run(sql: string, ...params: DbValue[]): Promise<void>;
	get<T extends object>(sql: string, ...params: DbValue[]): Promise<T | undefined>;
	all<T extends object>(sql: string, ...params: DbValue[]): Promise<T[]>;
}
export interface Db extends DbExecutor {
	transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

export interface RuntimeModelHealth {
	load(): Promise<void>;
	held(key: string): boolean;
	order<T>(entries: readonly T[], key: (entry: T) => string): T[];
	due(at?: number): string[];
	snapshot(): Record<string, { until: number; probeAt: number; reason: string; failures: number; resetUntil?: number }>;
	hold(
		keys: readonly string[],
		reason: string,
		seconds: number,
		probe: number,
		failures?: number,
		resetUntil?: number,
	): Promise<void>;
	clear(keys: readonly string[]): Promise<void>;
	probed(keys: readonly string[], probe: number): Promise<void>;
}

export interface RuntimeModelQuota {
	load(): Promise<void>;
	window(
		account: string,
	): { usedPercent: number; windowMinutes: number; resetsAt: number; updatedAt: number } | undefined;
	blocked(account: string, stopPercent: number | undefined, at?: number): boolean;
	record(account: string, data: unknown): void;
	recordWindow(
		account: string,
		window: { usedPercent: number; windowMinutes: number; resetsAt: number; updatedAt: number },
	): void;
	flush(): Promise<void>;
	snapshot(): Record<string, { usedPercent: number; windowMinutes: number; resetsAt: number; updatedAt: number }>;
}

export type RuntimeModels = import("@yonder/sdk").Models & {
	setProvider(provider: import("@earendil-works/pi-ai").Provider): void;
	deleteProvider(id: string): void;
};

/** Services supplied by a host; the default runtime never locates or opens local resources itself. */
export interface RuntimeCredentialSlots {
	defaults: import("@earendil-works/pi-ai").CredentialStore;
	capture(
		selection: Readonly<Record<string, string>>,
		aliases?: Readonly<Record<string, { provider: string; slot: string }>>,
	): Promise<Record<string, string>>;
	bind(
		selection: Readonly<Record<string, string>>,
		generations?: Record<string, string>,
		aliases?: Readonly<Record<string, { provider: string; slot: string }>>,
	): import("@earendil-works/pi-ai").CredentialStore;
	beginLogin(
		provider: string,
		slot: string,
		replace?: boolean,
		options?: { signal?: AbortSignal },
	): Promise<{ provider: string; slot: string; generation: string; replace: boolean }>;
	commitLogin(
		ticket: { provider: string; slot: string; generation: string; replace: boolean },
		credential: import("@earendil-works/pi-ai").Credential,
		options?: { signal?: AbortSignal },
	): Promise<void>;
}

export interface RuntimeModelWatch {
	order(
		chain: readonly import("./runtime/model-chain.js").ChainEntry[],
		stops: import("./runtime/model-gate.js").QuotaStops | undefined,
	): import("./runtime/model-chain.js").ChainEntry[];
	record(
		config: import("./types.js").RuntimeSessionConfig,
		run: import("./types.js").RuntimeRun,
		attempts: readonly unknown[],
	): Promise<void>;
	tick(now: number): Promise<void>;
	stop(): void;
}
export interface RuntimeModelGate {
	order(
		chain: readonly import("./runtime/model-chain.js").ChainEntry[],
		stops: import("./runtime/model-gate.js").QuotaStops | undefined,
	): import("./runtime/model-chain.js").ChainEntry[];
}
export interface RuntimeQuotaPoller {
	watch(accounts: Iterable<{ provider: string; slot: string }>): void;
	tick(now: number): Promise<void>;
	stop(): void;
}

export interface RuntimeBackground {
	busy(): boolean;
	extension: import("@earendil-works/pi-durable").Extension;
	running: Map<number, RuntimeLiveOutput>;
	tools: import("@earendil-works/pi-durable").ToolRegistration[];
	tool: import("@earendil-works/pi-durable").ToolRegistration;
	pending(taskId: number): Promise<boolean>;
	run(
		tool: import("@earendil-works/pi-durable").ToolRegistration,
		args: import("@earendil-works/pi-durable").JsonObject,
		api: import("@earendil-works/pi-durable").ToolExecutionApi,
		context: import("@earendil-works/chord").Context,
		extra?: { immediate?: boolean; label?: string; notify?: boolean },
	): Promise<import("@earendil-works/pi-durable").ToolExecutionResult>;
	list(
		session: string,
		storage: import("@earendil-works/pi-durable").Storage,
	): Promise<
		Array<{
			id: string;
			name: string;
			started: number;
			state: import("@earendil-works/pi-durable").TaskState<unknown, unknown>;
		}>
	>;
	manage(
		session: string,
		args: { action: "status" | "log" | "kill"; id: string; offset?: number },
	): Promise<{
		id: string;
		name: string | undefined;
		started: number | undefined;
		state: import("@earendil-works/pi-durable").TaskState<unknown, unknown>;
		output: string;
		offset: number;
		next: number;
		truncated: boolean;
	}>;
	recover(records: readonly { id: number; conversationId: number }[]): Promise<void>;
	close(): Promise<void>;
}

export interface RuntimeLiveOutput {
	output: string;
	write?: (text: string, eof?: boolean) => Promise<void>;
}

export interface RuntimeLimits {
	states: Map<string, import("./runtime/docs.js").RunState>;
	hooks(): import("@earendil-works/pi-durable").HookRegistration[];
	arm(state: import("./runtime/docs.js").RunState): void;
}

export interface RuntimePolicy {
	denied(
		name: string,
		args: import("@earendil-works/pi-durable").JsonObject,
		config: import("./types.js").RuntimeSessionConfig,
		context: import("@earendil-works/chord").Context,
		session: string,
	): Promise<string | undefined>;
}

export interface RuntimeServices {
	credentials: import("@earendil-works/pi-ai").CredentialStore;
	credentialSlots: RuntimeCredentialSlots;
	health: RuntimeModelHealth;
	quota: RuntimeModelQuota;
	gate: RuntimeModelGate;
	watch: RuntimeModelWatch;
	quotaPoller?: RuntimeQuotaPoller;
	models: RuntimeModels;
	modelsFor(config: {
		resolved: { model: string; fallback?: unknown; credentialSlots: Readonly<Record<string, string>> };
	}): Promise<RuntimeModels>;
	environment(config: { cwd: string; resolved: { env: string } }): import("@yonder/sdk").ExecutionEnv;
	readAttachment(
		uri: string,
		env: import("@yonder/sdk").ExecutionEnv,
		context: import("@earendil-works/chord").Context,
	): Promise<Uint8Array>;
	imageProcessor(): Promise<import("@earendil-works/pi-durable/tools").ImageProcessor>;
	attachmentInput?: "inline" | "reference";
	toolHost: import("./runtime/tool-activation.js").RuntimeToolHost;
	executeCommand(
		config: import("./types.js").RuntimeSessionConfig,
		request: { command: string | string[]; cwd?: string; signal?: AbortSignal },
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	resolveService(capability: string): Promise<import("@yonder/sdk").ServiceEndpoint | undefined>;
	login(
		provider: string,
		type: "api_key" | "oauth",
		interaction: Parameters<import("@yonder/sdk").Models["login"]>[2],
	): Promise<void>;
	refreshModels?(): Promise<void>;
	attachRuntime?(runtime: import("./runtime/instance.js").RuntimeInternals): void;
}
