// 跨平台的临时 home 目录，供测试使用（`@yonder/sdk/testing`）。
//
// 三种平台各坏一种：Windows 没有 /tmp；macOS 的 os.tmpdir() 很长，home 下再拼
// `.yonder/plugins/channel-cli/cli.sock` 会超过 AF_UNIX 的 104 字节上限（listen EINVAL）；
// Linux 两者都还行。这里统一挑一个短且可写的根目录。
import { accessSync, constants, mkdtempSync } from "node:fs";
import { access, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHORT_ROOTS = ["/tmp"];

/** 短且可写的临时根；没有就退回 `os.tmpdir()`。 */
export async function tempRoot(): Promise<string> {
	for (const root of SHORT_ROOTS) {
		try {
			await access(root, constants.W_OK | constants.X_OK);
			return await realpath(root);
		} catch {
			// Not every platform has /tmp; fall through.
		}
	}
	return realpath(await tmpdir());
}

function shortRootSync(): string | undefined {
	return SHORT_ROOTS.find((root) => {
		try {
			accessSync(root, constants.W_OK | constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
}

/** 新建一个测试 home；`prefix` 沿用 `mkdtemp("/tmp/<prefix>")` 的写法（自带结尾连字符）。 */
export async function tempHome(prefix: string): Promise<string> {
	return mkdtemp(join(await tempRoot(), prefix));
}

/** `tempHome` 的同步版本，供同步测试体使用。 */
export function tempHomeSync(prefix: string): string {
	const root = shortRootSync() ?? tmpdir();
	return mkdtempSync(join(root, prefix));
}
