import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform === "darwin") {
	const contents = "packages/macos/dist/YonderStatus.app/Contents";
	mkdirSync(`${contents}/MacOS`, { recursive: true });
	mkdirSync(`${contents}/Resources`, { recursive: true });
	for (const name of ["menubar-template.png", "menubar-template@2x.png"])
		copyFileSync(`brand/assets/macos/${name}`, `${contents}/Resources/${name}`);
	copyFileSync("brand/assets/png/yonder-mark-512.png", `${contents}/Resources/dock-mark.png`);
	const { version } = JSON.parse(readFileSync("package.json", "utf8"));
	writeFileSync(
		`${contents}/Info.plist`,
		`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>YonderStatus</string><key>CFBundleIdentifier</key><string>dev.yonder.status</string>
<key>CFBundleName</key><string>Yonder Harness</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string><key>LSUIElement</key><true/></dict></plist>`,
	);
	const power = spawnSync(
		"/usr/bin/swiftc",
		["-parse-as-library", "packages/macos/PowerHelper.swift", "-o", `${contents}/Resources/YonderPower`],
		{ stdio: "inherit" },
	);
	if (power.status !== 0) throw new Error("Power helper build failed");
	const powerCheck = spawnSync(`${contents}/Resources/YonderPower`, ["--check"], { stdio: "inherit" });
	if (powerCheck.status !== 0) throw new Error("Power helper self-check failed");
	const result = spawnSync(
		"/usr/bin/swiftc",
		[
			"-module-cache-path",
			join(tmpdir(), "yonder-swift-module-cache"),
			"packages/macos/YonderStatus.swift",
			"packages/macos/GatewayClient.swift",
			"-o",
			`${contents}/MacOS/YonderStatus`,
		],
		{ stdio: "inherit" },
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
}

if (!process.exitCode) await import("./build-permissions.mjs");
