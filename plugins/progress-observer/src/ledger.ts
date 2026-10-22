import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Exec = "active" | "interrupted" | "missing" | "done" | "none";
export type Delivery = "not_sent" | "sent" | "unknown" | "failed";
export interface Task {
	id: string;
	label: string;
	executor: Exec;
	owner?: string | null;
	sourceSession?: string;
	sourceRun?: string;
	target?: string;
	executorSession?: string;
	runStatus?: string;
	milestone?: string;
	accepted: "pending" | "accepted" | "unknown";
	delivery: Delivery;
	quietUntil?: number;
	lastSent?: number;
	seen: string[];
	pending: string[];
	claimed?: string[];
	attempt?: string;
}
export type Event = {
	id: string;
	task: string;
	type:
		| "executor.active"
		| "executor.interrupted"
		| "executor.missing"
		| "run.end"
		| "milestone"
		| "accepted"
		| "delivery.sent"
		| "delivery.unknown"
		| "delivery.failed"
		| "quiet";
	at: number;
	value?: string;
	until?: number;
};
export interface Decision {
	decision: "skip" | "update" | "notify" | "ask";
	evidence: string[];
	text: string;
}
export function apply(t: Task, e: Event) {
	if (t.seen.includes(e.id)) return;
	t.seen.push(e.id);
	t.pending.push(e.id);
	switch (e.type) {
		case "executor.active":
			t.executor = "active";
			break;
		case "executor.interrupted":
			t.executor = "interrupted";
			break;
		case "executor.missing":
			t.executor = "missing";
			break;
		case "run.end":
			t.runStatus = e.value ?? "unknown";
			if (e.value === "done") t.executor = "done";
			else if (e.value === "aborted" || e.value === "error" || e.value === "limit" || e.value === "interrupted")
				t.executor = "interrupted";
			break;
		case "milestone":
			if (e.value !== undefined) t.milestone = e.value;
			break;
		case "accepted":
			t.accepted = "accepted";
			break;
		case "delivery.sent":
			t.delivery = "sent";
			break;
		case "delivery.unknown":
			t.delivery = "unknown";
			break;
		case "delivery.failed":
			t.delivery = "failed";
			break;
		case "quiet":
			if (e.until !== undefined) t.quietUntil = e.until;
			break;
	}
}
export function verifyDecision(input: unknown, t: Task, now: number): input is Decision {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const d = input as Record<string, unknown>;
	if (Object.keys(d).some((k) => !["decision", "evidence", "text"].includes(k))) return false;
	if (
		!["skip", "update", "notify", "ask"].includes(d.decision as string) ||
		typeof d.text !== "string" ||
		d.text.length > 500
	)
		return false;
	if (!Array.isArray(d.evidence) || d.evidence.length > 5 || d.evidence.some((id) => typeof id !== "string"))
		return false;
	// No durable trusted ownerRequired gate exists in this version; model-authored ask is never authority.
	if (d.decision === "ask") return false;
	if (d.decision === "skip") return d.evidence.length === 0;
	if (!d.evidence.length || d.evidence.some((id) => !t.pending.includes(id) || t.claimed?.includes(id))) return false;
	if (t.quietUntil && now < t.quietUntil) return false;
	if (t.delivery === "unknown" || (t.attempt && t.delivery !== "sent" && t.delivery !== "failed")) return false;
	return true;
}
export class Ledger {
	private tasks: Task[] = [];
	private writes: Promise<void> = Promise.resolve();
	constructor(private dir: string) {}
	async open() {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		try {
			this.tasks = JSON.parse(await readFile(join(this.dir, "tasks.json"), "utf8"));
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		}
		return this;
	}
	async create(
		id: string,
		label: string,
		association: Pick<Task, "owner" | "sourceSession" | "sourceRun" | "executorSession" | "target"> = {},
	) {
		if (this.tasks.some((t) => t.id === id)) throw Error("duplicate task");
		const t: Task = {
			id,
			label: label.slice(0, 120),
			executor: "none",
			accepted: "unknown",
			delivery: "not_sent",
			seen: [],
			pending: [],
			...association,
		};
		this.tasks.push(t);
		await this.save();
		return t;
	}
	async event(e: Event) {
		const t = this.tasks.find((x) => x.id === e.task);
		if (!t) throw Error("unknown task");
		apply(t, e);
		await this.save();
		return t;
	}
	async bindExecutor(id: string, session: string) {
		const task = this.tasks.find((item) => item.id === id);
		if (!task) throw Error("unknown task");
		if (task.executorSession && task.executorSession !== session) throw Error("executor session already bound");
		task.executorSession = session;
		await this.save();
		return task;
	}
	async decision(id: string, d: Decision, now = Date.now()) {
		const t = this.tasks.find((x) => x.id === id);
		if (!t) throw Error("unknown task");
		if (!verifyDecision(d, t, now)) throw Error("decision violates evidence/quiet policy");
		if (d.decision !== "skip") {
			const attemptId = randomUUID();
			t.attempt = attemptId;
			t.claimed = [...new Set([...(t.claimed ?? []), ...d.evidence])];
			t.delivery = "unknown";
			await this.save();
			return attemptId;
		}
		return undefined;
	}
	async receipt(id: string, attemptId: string, state: "sent" | "failed" | "unknown") {
		const t = this.tasks.find((x) => x.id === id);
		if (!t) throw Error("unknown task");
		if (t.attempt !== attemptId) return false;
		t.delivery = state;
		if (state === "sent") {
			t.lastSent = Date.now();
			const claimed = new Set(t.claimed ?? []);
			t.pending = t.pending.filter((id) => !claimed.has(id));
			t.claimed = [];
		}
		await this.save();
		return true;
	}
	async list() {
		return this.tasks;
	}
	private async save() {
		const write = this.writes.then(async () => {
			const p = join(this.dir, "tasks.json"),
				tmp = `${p}.${randomUUID()}.tmp`;
			await writeFile(tmp, JSON.stringify(this.tasks), { mode: 0o600 });
			await rename(tmp, p);
		});
		this.writes = write.catch(() => {});
		await write;
	}
}
export function stateHash(t: Task) {
	return createHash("sha256")
		.update(JSON.stringify([t.executor, t.milestone, t.accepted, t.delivery]))
		.digest("hex")
		.slice(0, 16);
}
export function executorStatusText(executor: Task["executor"]): string {
	if (executor === "interrupted") return "执行中断；尚未核实续跑。";
	if (executor === "missing") return "未找到执行者的可靠记录；尚未核实续跑。";
	return `执行状态：${executor}`;
}

export function safeFallback(t: Task): Decision {
	const evidence = t.pending.slice(-3);
	if (t.executor === "interrupted" || t.executor === "missing")
		return { decision: "notify", evidence, text: executorStatusText(t.executor) };
	if (t.delivery === "unknown") return { decision: "update", evidence, text: "投递结果未知；不会自动重发。" };
	return { decision: "skip", evidence: [], text: "" };
}
