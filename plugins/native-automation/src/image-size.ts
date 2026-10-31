import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** 截图进模型前的长边上限：看清界面够用，不必是原始分辨率。 */
export const MAX_EDGE = 1600;
/** 小于这个大小的截图不值得再转一次。 */
const ALREADY_SMALL = 512 * 1024;

export interface ShrunkImage {
	/** 实际保存的路径；转码成功时是新的 .jpg。 */
	path: string;
	bytes: Buffer;
	mime: "image/png" | "image/jpeg";
	/** 原始字节数，写进工具结果便于判断发生了什么。 */
	original: number;
}

/**
 * 截图先在本机缩小再交给内核。
 *
 * 内核已经会在工具出口重新编码，但那是在整张原图读进内存、base64 之后再做的：7 MB 的 Retina 截图仍会写进
 * artifact 目录、占用一次内存峰值。这里在插件侧先转成 1600 长边的 JPEG，产物文件本身也变小。`sips` 是 macOS
 * 自带工具，失败时原样返回，不因为压缩失败丢掉截图。
 */
export async function shrinkForModel(path: string, options: { maxEdge?: number } = {}): Promise<ShrunkImage> {
	const before = await stat(path);
	const original = before.size;
	const unchanged = async (): Promise<ShrunkImage> => ({
		path,
		bytes: await readFile(path),
		mime: "image/png",
		original,
	});
	if (process.platform !== "darwin" || original <= ALREADY_SMALL) return unchanged();
	const out = `${path}.jpg`;
	try {
		await run(
			"sips",
			[
				"-Z",
				String(options.maxEdge ?? MAX_EDGE),
				"-s",
				"format",
				"jpeg",
				"-s",
				"formatOptions",
				"78",
				path,
				"--out",
				out,
			],
			{ timeout: 20_000 },
		);
		const bytes = await readFile(out);
		// 转完反而更大就不换（例如本来就是小尺寸高压缩的 PNG）。
		if (bytes.byteLength >= original) {
			await rm(out, { force: true });
			return unchanged();
		}
		return { path: out, bytes, mime: "image/jpeg", original };
	} catch {
		await rm(out, { force: true }).catch(() => undefined);
		return unchanged();
	}
}
