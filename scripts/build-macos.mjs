import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform === "darwin") {
	const contents = "packages/macos/dist/YonderStatus.app/Contents";
	mkdirSync(`${contents}/MacOS`, { recursive: true });
	const { version } = JSON.parse(readFileSync("package.json", "utf8"));
	writeFileSync(
		`${contents}/Info.plist`,
		`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>YonderStatus</string><key>CFBundleIdentifier</key><string>dev.yonder.harness.status</string>
<key>CFBundleName</key><string>Yonder Harness</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string><key>LSUIElement</key><true/></dict></plist>`,
	);
	const result = spawnSync(
		"/usr/bin/swiftc",
		[
			"-module-cache-path",
			join(tmpdir(), "yonder-swift-module-cache"),
			"packages/macos/YonderStatus.swift",
			"-o",
			`${contents}/MacOS/YonderStatus`,
		],
		{ stdio: "inherit" },
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
}

if (!process.exitCode) await import("./build-permissions.mjs");
