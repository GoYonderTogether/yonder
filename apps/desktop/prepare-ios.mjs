// 重放 `tauri ios init` 之后需要补在生成工程上的设置（按仓库的既有做法：生成目录不入库，
// 每次 init 之后由这里补回来）。桌面 / 移动两处入口共用这一份：
//   node apps/desktop/prepare-ios.mjs
//
// 做三件事，全部幂等：
//   1. App 图标：App Store 拒绝带 alpha 的 1024 图标（上传报 90717）。Tauri 从品牌 PNG 生成的
//      图标带透明通道，这里用 scripts/flatten-icon.swift 铺白底重新生成整套尺寸。
//   2. 签名：写 DEVELOPMENT_TEAM / CODE_SIGN_STYLE=Manual / PROVISIONING_PROFILE_SPECIFIER，
//      并把 CODE_SIGN_IDENTITY 从 "iPhone Developer" 换成 "iPhone Distribution"
//      （前者只匹配开发证书，分发构建会报 No signing certificate）。
//   3. 团队 ID 与 profile 名可用环境变量覆盖（CI 用 secrets）：IOS_TEAM_ID / IOS_PROFILE_NAME。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const apple = resolve(root, "src-tauri/gen/apple");
const projectFile = join(apple, "yonder-desktop.xcodeproj/project.pbxproj");
const iconSet = join(apple, "Assets.xcassets/AppIcon.appiconset");
const brandIcon = resolve(root, "../../brand/assets/png/yonder-tile-ink-1024.png");
const flutter = join(root, "scripts/flatten-icon.swift");

const team = process.env.IOS_TEAM_ID ?? "D4UZU32UN9";
const profile = process.env.IOS_PROFILE_NAME ?? "Yonder App Store";

if (!existsSync(apple) || !existsSync(projectFile)) {
	console.error(`prepare-ios: run \`tauri ios init\` first (${apple} is missing)`);
	process.exit(1);
}

/** 1. 图标：铺白底、去掉 alpha，再按 Contents.json 的尺寸重出整套。 */
function applyIcons() {
	if (!existsSync(iconSet) || !existsSync(brandIcon) || !existsSync(flutter)) {
		console.log("prepare-ios: icon sources missing; icons left as generated");
		return;
	}
	const binary = join(apple, ".flatten-icon");
	if (!existsSync(binary)) execFileSync("swiftc", ["-O", flutter, "-o", binary], { stdio: "inherit" });
	const opaque = join(apple, ".icon-opaque.png");
	execFileSync(binary, [brandIcon, opaque], { stdio: "inherit" });
	const contents = JSON.parse(readFileSync(join(iconSet, "Contents.json"), "utf8"));
	for (const image of contents.images) {
		if (!image.filename) continue;
		const points = Number.parseFloat(String(image.size).split("x")[0]);
		const scale = Number.parseInt(String(image.scale).replace("x", ""), 10);
		const pixels = String(Math.round(points * scale));
		execFileSync("sips", ["-z", pixels, pixels, opaque, "--out", join(iconSet, image.filename)], {
			stdio: "ignore",
		});
	}
	console.log("prepare-ios: app icons flattened (no alpha channel)");
}

/** 2. 签名设置；3. 团队与 profile 从环境变量取。 */
function applySigning() {
	let source = readFileSync(projectFile, "utf8");
	if (source.includes("DEVELOPMENT_TEAM")) {
		console.log("prepare-ios: signing settings already present");
		return;
	}
	if (!source.includes('CODE_SIGN_IDENTITY = "iPhone Developer";')) {
		console.error("prepare-ios: unexpected project layout (no CODE_SIGN_IDENTITY = \"iPhone Developer\")");
		process.exit(1);
	}
	source = source.replace(
		/CODE_SIGN_IDENTITY = "iPhone Developer";/g,
		[
			'CODE_SIGN_IDENTITY = "iPhone Distribution";',
			`DEVELOPMENT_TEAM = ${team};`,
			"CODE_SIGN_STYLE = Manual;",
			`PROVISIONING_PROFILE_SPECIFIER = "${profile}";`,
		].join("\n\t\t\t\t"),
	);
	writeFileSync(projectFile, source);
	console.log(`prepare-ios: signing wired to team ${team}, profile "${profile}"`);
}

applyIcons();
applySigning();
