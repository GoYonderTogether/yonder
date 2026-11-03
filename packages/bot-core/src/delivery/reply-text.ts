import type { OutputPart } from "@yonder/sdk";
/** Hold only the prefix that may still be the model's control marker. */
export class ReplyText {
	private pending = "";
	private released = false;
	push(delta: string): string {
		if (this.released) return delta;
		this.pending += delta;
		if ("NO_REPLY".startsWith(this.pending.trimStart()) || this.pending.trim() === "NO_REPLY") return "";
		this.released = true;
		const text = this.pending;
		this.pending = "";
		return text;
	}
}

export class OutputQueue implements AsyncIterable<OutputPart> {
	private pending: OutputPart[] = [];
	private wake: (() => void) | undefined;
	private ended = false;
	push(part: OutputPart) {
		if (this.ended) return;
		this.pending.push(part);
		this.wake?.();
		this.wake = undefined;
	}
	end() {
		this.ended = true;
		this.wake?.();
		this.wake = undefined;
	}
	async *[Symbol.asyncIterator](): AsyncIterator<OutputPart> {
		while (true) {
			while (this.pending.length) yield this.pending.shift() as OutputPart;
			if (this.ended) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}
