import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MAX_EDGE, shrinkForModel } from "../src/image-size.js";

const darwin = process.platform === "darwin";
let dir = "";

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "yonder-image-size-"));
});

afterAll(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

/** 用系统壁纸生成一张大 PNG：纯色图转 JPEG 反而更大，必须用真实照片才测得到压缩。 */
function makePng(path: string, width: number, height: number) {
	execFileSync(
		"sips",
		[
			"-s",
			"format",
			"png",
			"-Z",
			String(Math.max(width, height)),
			"/System/Library/Desktop Pictures/Mac Blue.heic",
			"--out",
			path,
		],
		{ stdio: "ignore" },
	);
}

test.skipIf(!darwin)("a large retina screenshot is shrunk to a smaller JPEG and keeps the original", async () => {
	const path = join(dir, "big.png");
	makePng(path, 3200, 2000);
	const before = (await stat(path)).size;
	const shrunk = await shrinkForModel(path);
	expect(shrunk.original).toBe(before);
	expect(shrunk.mime).toBe("image/jpeg");
	expect(shrunk.path).toBe(`${path}.jpg`);
	expect(shrunk.bytes.byteLength).toBeLessThan(before);
	expect((await stat(path)).size).toBe(before);
	// 长边不超过上限。
	const probe = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", shrunk.path], { encoding: "utf8" });
	const width = Number(/pixelWidth: (\d+)/.exec(probe)?.[1]);
	const height = Number(/pixelHeight: (\d+)/.exec(probe)?.[1]);
	expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_EDGE);
});

test.skipIf(!darwin)("a missing file falls back without throwing", async () => {
	await expect(shrinkForModel(join(dir, "missing.png"))).rejects.toThrow();
});

test.skipIf(!darwin)("a small image is returned unchanged", async () => {
	const path = join(dir, "small.png");
	makePng(path, 320, 200);
	const bytes = await readFile(path);
	const shrunk = await shrinkForModel(path);
	expect(shrunk.path).toBe(path);
	expect(shrunk.mime).toBe("image/png");
	expect(shrunk.bytes.equals(bytes)).toBe(true);
});

test.skipIf(!darwin)("a file sips cannot read is returned as-is", async () => {
	const path = join(dir, "not-an-image.png");
	await writeFile(path, Buffer.alloc(600 * 1024, 1));
	const shrunk = await shrinkForModel(path);
	expect(shrunk.path).toBe(path);
	expect(shrunk.mime).toBe("image/png");
});
