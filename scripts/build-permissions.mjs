import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform === "darwin") {
	const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" });
	const pkg = "packages/macos-helper";
	process.stderr.write(run("swift", ["package", "--package-path", pkg, "resolve"]));
	const checkout = `${root}${pkg}/.build/checkouts/PermissionFlow`;
	const patch = `${root}${pkg}/patches/PermissionFlow-guide.patch`;
	const apply = (args) => spawnSync("git", ["apply", ...args, patch], { cwd: checkout, encoding: "utf8" });
	if (apply(["--reverse", "--check"]).status !== 0) {
		const result = apply([]);
		if (result.status !== 0) throw new Error(`PermissionFlow patch failed: ${result.stderr}`);
	}
	process.stderr.write(run("swift", ["build", "--package-path", pkg, "-j", "4"]));
	const bin = run("swift", ["build", "--package-path", pkg, "--show-bin-path"]).trim();
	const app = `${root}${pkg}/dist/Yonder Helper.app`;
	mkdirSync(`${app}/Contents/MacOS`, { recursive: true });
	mkdirSync(`${app}/Contents/Resources`, { recursive: true });
	cpSync(`${bin}/YonderHelper`, `${app}/Contents/MacOS/YonderHelper`);
	for (const name of readdirSync(bin).filter((name) => name.endsWith(".bundle")))
		cpSync(`${bin}/${name}`, `${app}/Contents/Resources/${name}`, { recursive: true });
	writeFileSync(
		`${app}/Contents/Info.plist`,
		`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>YonderHelper</string><key>CFBundleIdentifier</key><string>dev.yonder.harness.helper</string>
<key>CFBundleDisplayName</key><string>Yonder</string>
<key>CFBundleName</key><string>Yonder Helper</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/>
<key>NSLocationUsageDescription</key><string>Yonder uses your location only for owner-requested local collection.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Yonder uses your location only for owner-requested local collection.</string>
<key>NSCameraUsageDescription</key><string>Owner-requested Yonder camera access.</string>
<key>NSMicrophoneUsageDescription</key><string>Owner-requested Yonder microphone access.</string>
<key>NSAppleEventsUsageDescription</key><string>Owner-requested System Events automation.</string></dict></plist>`,
	);
	const identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
	const identity =
		process.env.YONDER_HELPER_SIGN_IDENTITY ??
		identities.match(/\b([A-F0-9]{40}) "(?:Developer ID Application|Apple Development):/u)?.[1] ??
		"-";
	// Automatic DR keeps the certificate/team + bundle identifier stable; ad-hoc DR includes cdhash.
	process.stderr.write(
		`Helper signing: ${identity === "-" ? "ad-hoc (grants may require renewal after rebuild)" : identity}\n`,
	);
	process.stderr.write(run("codesign", ["--force", "--sign", identity, "--timestamp=none", app]));
	run("codesign", ["--verify", "--strict", app]);
}
