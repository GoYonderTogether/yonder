import { posix } from "node:path";
import type { PluginFiles } from "@yonder/sdk";
import { memoryFiles } from "./files.js";

const queues = new Map<string | object, Promise<unknown>>();
export async function serial<T>(path: string | object, run: () => Promise<T>): Promise<T> {
	const work = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(run);
	queues.set(path, work);
	try {
		return await work;
	} finally {
		if (queues.get(path) === work) queues.delete(path);
	}
}
export interface WriteContext {
	op: string;
	id: string;
	by: string;
	session: string;
	signal: AbortSignal;
}
export class Store {
	readonly files: PluginFiles;
	constructor(
		readonly root: string,
		files?: PluginFiles,
	) {
		this.files = files ?? memoryFiles(root);
	}
	private target(path: string): string {
		const normalized = posix.normalize(path.replaceAll("\\", "/"));
		if (normalized === "mine" || normalized.startsWith("mine/")) throw new Error("mine is read-only");
		return normalized;
	}
	private line(path: string, ctx: WriteContext) {
		return `${new Date().toISOString()} ${ctx.op} ${path} ${ctx.id} by ${ctx.by} session:${ctx.session}\n`;
	}
	async log(path: string, ctx: WriteContext) {
		ctx.signal.throwIfAborted();
		await this.files.append("log.md", this.line(path, ctx));
	}
	async edit(path: string, transform: (text: string | undefined) => string | Promise<string>, ctx: WriteContext) {
		path = this.target(path);
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.files.transaction(async (files) => {
					ctx.signal.throwIfAborted();
					const old = await files.read(path);
					const next = await transform(old);
					ctx.signal.throwIfAborted();
					if (next === old) return;
					await files.write(path, next);
					await files.append("log.md", this.line(path, ctx));
				});
			} catch (error) {
				if (!(error instanceof Error) || !error.message.startsWith("Concurrent edit conflict")) throw error;
				if (attempt) throw new Error("Concurrent edit conflict after one retry; user changes preserved");
			}
		}
	}
	async ensure(path: string, template: string, ctx: WriteContext) {
		await this.edit(path, (text) => text ?? template, ctx);
	}
	async append(path: string, template: string, block: (text: string) => string, ctx: WriteContext) {
		path = this.target(path);
		await this.files.transaction(async (files) => {
			ctx.signal.throwIfAborted();
			let old = await files.read(path);
			if (old === undefined) {
				old = template;
				await files.write(path, old);
				await files.append("log.md", this.line(path, ctx));
			}
			await files.append(path, `${old.endsWith("\n") ? "" : "\n"}${block(old)}`);
			await files.append("log.md", this.line(path, ctx));
		});
	}
}
