// 重放 `tauri ios init` 之后需要补在生成工程上的设置（按仓库的既有做法：生成目录不入库，
// 每次 init 之后由这里补回来）。桌面 / 移动两处入口共用这一份：
//   node apps/desktop/prepare-ios.mjs
//
// 做五件事，全部幂等：
//   1. App 图标：App Store 拒绝带 alpha 的 1024 图标（上传报 90717）。Tauri 从品牌 PNG 生成的
//      图标带透明通道，这里用 scripts/flatten-icon.swift 铺白底重新生成整套尺寸。
//   2. 签名：写 DEVELOPMENT_TEAM / CODE_SIGN_STYLE=Manual / PROVISIONING_PROFILE_SPECIFIER，
//      并把 CODE_SIGN_IDENTITY 从 "iPhone Developer" 换成 "iPhone Distribution"
//      （前者只匹配开发证书，分发构建会报 No signing certificate）。
//   3. 团队 ID 与 profile 名可用环境变量覆盖（CI 用 secrets）：IOS_TEAM_ID / IOS_PROFILE_NAME。
//   4. 权限用途说明（Info.plist）：日历、提醒事项、通讯录、照片、位置、健康，各一句中文。
//      yonder-device 插件在运行时向系统要这些授权，缺 key 会直接崩溃。
//   5. HealthKit capability：project.yml 追加 com.apple.HealthKit entitlement + SYSTEM_HEADERS 搜索路径，
//      之后用 xcodegen 重新生成工程（与 ios-device.sh 的既有重生成顺序一致）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const apple = resolve(root, "src-tauri/gen/apple");
const projectFile = join(apple, "yonder-desktop.xcodeproj/project.pbxproj");
const projectYml = join(apple, "project.yml");
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
		console.error('prepare-ios: unexpected project layout (no CODE_SIGN_IDENTITY = "iPhone Developer")');
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

/** 4. 权限用途说明：追加进 project.yml 的 Info.plist properties，再由 xcodegen 写入 plist。 */
const USAGE_KEYS = [
	"NSCalendarsUsageDescription",
	"NSRemindersUsageDescription",
	"NSContactsUsageDescription",
	"NSPhotoLibraryUsageDescription",
	"NSLocationWhenInUseUsageDescription",
	"NSHealthShareUsageDescription",
	"NSHealthUpdateUsageDescription",
];
const USAGE_SENTENCE = "Yonder 在你同意后读取对应数据，为你提供相关 Bot 能力。";

function applyUsageDescriptions() {
	if (!existsSync(projectYml)) {
		console.error(`prepare-ios: ${projectYml} missing (did tauri ios init run?)`);
		process.exit(1);
	}
	let yml = readFileSync(projectYml, "utf8");
	if (yml.includes("NSCalendarsUsageDescription")) {
		console.log("prepare-ios: usage descriptions already present");
		return;
	}
	const anchor = "        CFBundleShortVersionString:";
	if (!yml.includes(anchor)) {
		console.error("prepare-ios: unexpected project.yml layout (no CFBundleShortVersionString line)");
		process.exit(1);
	}
	const additions = USAGE_KEYS.map((key) => `        ${key}: ${USAGE_SENTENCE}`).join("\n");
	yml = yml.replace(anchor, `${additions}\n${anchor}`);
	writeFileSync(projectYml, yml);
	console.log("prepare-ios: permission usage descriptions added to Info.plist properties");
}

/** 5. HealthKit capability：entitlements 加 com.apple.HealthKit，target 加 HealthKit framework。 */
function applyHealthKit() {
	let yml = readFileSync(projectYml, "utf8");
	let changed = false;
	if (!yml.includes("com.apple.HealthKit")) {
		if (!yml.includes("        path: {{app.name}}_iOS/{{app.name}}_iOS.entitlements")) {
			console.error("prepare-ios: unexpected project.yml layout (no entitlements path line)");
			process.exit(1);
		}
		// project.yml 的 entitlements 段是 xcodegen 的 `entitlements: path:`（模板渲染后的名字已是
		// yonder-desktop_iOS），entitlements 文件由 xcodegen 生成；属性写在 entitlements.properties。
		yml = yml.replace(
			/(    entitlements:\n      path: (\S+)\n)/,
			"$1      properties:\n        com.apple.HealthKit: true\n",
		);
		changed = true;
	}
	if (!yml.includes("- HealthKit.framework")) {
		const sdkAnchor = "      - sdk: WebKit.framework";
		if (!yml.includes(sdkAnchor)) {
			console.error("prepare-ios: unexpected project.yml layout (no WebKit.framework sdk line)");
			process.exit(1);
		}
		yml = yml.replace(sdkAnchor, `      - sdk: HealthKit.framework\n${sdkAnchor}`);
		changed = true;
	}
	if (!changed) {
		console.log("prepare-ios: HealthKit capability already present");
		return;
	}
	writeFileSync(projectYml, yml);
	console.log("prepare-ios: HealthKit entitlement + framework added to project.yml");
}

/** xcodegen 重生成工程：前四步只改 project.yml 的必须收尾。 */
function regenerate() {
	if (!existsSync(projectYml)) return;
	const needsRegen = readFileSync(projectYml, "utf8").includes("NSCalendarsUsageDescription");
	if (!needsRegen) return;
	execFileSync("xcodegen", ["generate"], { cwd: apple, stdio: "inherit" });
	console.log("prepare-ios: Xcode project regenerated with usage descriptions + HealthKit");
}

applyIcons();
applySigning();
applyUsageDescriptions();
applyHealthKit();
regenerate();
