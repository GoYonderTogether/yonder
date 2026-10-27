import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { statusPath, type StatusSnapshot } from "./snapshot.js";

/**
 * 原子发布状态文件。
 *
 * 为什么用文件而不是 socket：菜单栏是长期存在的读者，进程会重启。
 * 文件读一次是微秒级，断线重连、跨重启、手工排查都不需要额外协议。
 * 用 tmp + rename 保证读者永远看不到写了一半的内容。
 */
export function createPublisher(home: string) {
	let last: StatusSnapshot | undefined;
	let writing: Promise<void> = Promise.resolve();
	return {
		path: statusPath(home),
		/** 返回是否真的写了。内容没变且不强制时就不碰磁盘。 */
		async publish(next: StatusSnapshot, force = false): Promise<boolean> {
			if (!force && last && sameAsLast(last, next)) return false;
			last = next;
			const path = statusPath(home);
			const body = `${JSON.stringify(next)}\n`;
			// 串行化写入：并发 rename 会让读者读到较早的一份。
			writing = writing.then(async () => {
				await mkdir(dirname(path), { recursive: true, mode: 0o700 });
				const temporary = `${path}.${process.pid}.tmp`;
				await writeFile(temporary, body, { mode: 0o600 });
				await rename(temporary, path);
			});
			await writing;
			return true;
		},
		async close(): Promise<void> {
			await writing;
		},
	};
}

function sameAsLast(a: StatusSnapshot, b: StatusSnapshot): boolean {
	return (
		a.ready === b.ready &&
		a.version === b.version &&
		a.active === b.active &&
		JSON.stringify(a.agents) === JSON.stringify(b.agents)
	);
}
