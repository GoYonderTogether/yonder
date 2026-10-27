import { randomBytes } from "node:crypto";
import { type HostCtx, registry } from "@yonder/core";

const RING = 2000;
const GRACE_MS = 5 * 60_000;

export interface FeedEvent {
	seq: number;
	ts: string;
	data: unknown;
}
export interface Listener {
	push(event: FeedEvent): void;
	end(reason: "closed" | "error", error?: string): void;
}

/**
 * One upstream observation shared by every subscriber of the same (method, params).
 * Resumable feeds keep a ring buffer for a grace period after the last subscriber leaves,
 * so a client that reconnects with `after` gets the missed events instead of a gap.
 */
export class Feed {
	readonly epoch = randomBytes(6).toString("hex");
	seq = 0;
	initial: unknown;
	readonly ring: FeedEvent[] = [];
	readonly listeners = new Set<Listener>();
	private readonly abort = new AbortController();
	private timer: NodeJS.Timeout | undefined;
	closed = false;
	constructor(
		readonly key: string,
		readonly method: string,
		readonly resumable: boolean,
		private readonly onDead: (feed: Feed) => void,
	) {}

	async start(params: unknown, ctx: HostCtx): Promise<void> {
		this.initial = await registry.call(this.method, params, ctx, this.abort.signal, async (data) => this.publish(data));
		// A resumable feed's first event describes the state `initial` already covers; anything later is incremental.
	}
	publish(data: unknown) {
		if (this.closed) return;
		const event: FeedEvent = { seq: ++this.seq, ts: new Date().toISOString(), data };
		if (this.resumable) {
			this.ring.push(event);
			if (this.ring.length > RING) this.ring.shift();
		}
		for (const listener of this.listeners) listener.push(event);
	}
	cursor() {
		return `${this.epoch}:${this.seq}`;
	}
	/** Events after `after`, or undefined when that point is no longer (or never was) in this feed. */
	replay(after: string): FeedEvent[] | undefined {
		const [epoch, raw] = after.split(":");
		const seq = Number(raw);
		if (!this.resumable || epoch !== this.epoch || !Number.isInteger(seq) || seq < 0 || seq > this.seq)
			return undefined;
		const oldest = this.ring[0]?.seq ?? this.seq + 1;
		if (seq + 1 < oldest) return undefined;
		return this.ring.filter((event) => event.seq > seq);
	}
	join(listener: Listener) {
		clearTimeout(this.timer);
		this.listeners.add(listener);
	}
	leave(listener: Listener) {
		this.listeners.delete(listener);
		if (this.listeners.size || this.closed) return;
		this.timer = setTimeout(() => this.close(), this.resumable ? GRACE_MS : 0);
		this.timer.unref();
	}
	close(error?: string) {
		if (this.closed) return;
		this.closed = true;
		clearTimeout(this.timer);
		this.abort.abort();
		for (const listener of this.listeners) listener.end(error ? "error" : "closed", error);
		this.listeners.clear();
		this.onDead(this);
	}
}

export class Feeds {
	private readonly feeds = new Map<string, Feed>();
	/** Shared feed for (method, params); concurrent callers wait on the same startup. */
	private readonly starting = new Map<string, Promise<Feed>>();
	async acquire(method: string, params: unknown, ctx: HostCtx): Promise<Feed> {
		const key = `${method}\u0000${JSON.stringify(params)}`;
		const live = this.feeds.get(key);
		if (live && !live.closed) return live;
		const pending = this.starting.get(key);
		if (pending) return pending;
		const def = registry.get(method);
		const feed = new Feed(key, method, def?.stream?.resumable ?? false, (dead) => {
			if (this.feeds.get(dead.key) === dead) this.feeds.delete(dead.key);
		});
		const start = feed.start(params, ctx).then(
			() => {
				this.starting.delete(key);
				this.feeds.set(key, feed);
				return feed;
			},
			(error) => {
				this.starting.delete(key);
				feed.close();
				throw error;
			},
		);
		this.starting.set(key, start);
		return start;
	}
	closeAll() {
		for (const feed of [...this.feeds.values()]) feed.close();
	}
}
