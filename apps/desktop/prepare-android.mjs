#!/usr/bin/env node
/**
 * Re-apply local-only settings to the generated Android project.
 *
 * `tauri android init` regenerates `src-tauri/gen/android` from scratch and that tree is
 * gitignored, so anything we add to it by hand is lost. This script re-applies two things
 * idempotently after `tauri android init` and before `tauri android build`:
 *
 *   1. Release signing — writes `keystore.properties` (holds the store path and passwords)
 *      and inserts the `signingConfigs` block plus the release `signingConfig` line.
 *      Without a keystore, release builds stay unsigned so a fresh checkout still builds.
 *   2. Gradle repository mirrors — `dl.google.com` is unreachable from mainland networks and
 *      the default `google()`/`mavenCentral()` fail with a TLS handshake error. The mirrors
 *      are prepended and fall back to the originals, so machines that can reach Google are
 *      unaffected. Skip with `--no-mirrors`.
 *
 *   node apps/desktop/prepare-android.mjs [--keystore <path>] [--alias <name>] [--no-mirrors]
 *
 * Without `--keystore` it reads `YONDER_ANDROID_KEYSTORE`, falling back to
 * `~/.yonder-signing/android/yonder-release.jks`. Passwords come from
 * `YONDER_ANDROID_KEYSTORE_PASSWORD`, else from `keystore.password` beside the keystore.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const android = resolve(root, "src-tauri/gen/android");
const appGradle = join(android, "app/build.gradle.kts");
const rootGradle = join(android, "build.gradle.kts");
const buildSrcGradle = join(android, "buildSrc/build.gradle.kts");
const gradleProperties = join(android, "gradle.properties");
const propertiesFile = join(android, "keystore.properties");

const args = process.argv.slice(2);
const flag = (name) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? undefined : args[at + 1];
};

const keystore = resolve(
	flag("keystore") ??
		process.env.YONDER_ANDROID_KEYSTORE ??
		join(homedir(), ".yonder-signing/android/yonder-release.jks"),
);
const alias = flag("alias") ?? "yonder";
const mirrors = !args.includes("--no-mirrors");
if (!existsSync(android) || !existsSync(appGradle) || !existsSync(rootGradle)) {
	console.error(`prepare-android: run \`tauri android init\` first (${android} is missing)`);
	process.exit(1);
}

function applyMirrors() {
	// buildSrc resolves its own classpath before any allprojects block applies, so it needs
	// the mirrors in its own repositories block too.
	const files = [rootGradle, buildSrcGradle].filter((file) => existsSync(file));
	const mirror = `        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
`;
	for (const file of files) {
		let source = readFileSync(file, "utf8");
		if (source.includes("maven.aliyun.com")) {
			console.log(`prepare-android: mirrors already present in ${file.slice(android.length + 1)}`);
			continue;
		}
		const pattern = /(repositories \{\n)/g;
		const count = (source.match(pattern) ?? []).length;
		if (count === 0) {
			console.error(`prepare-android: unexpected layout in ${file} (no \`repositories {\` blocks)`);
			process.exit(1);
		}
		source = source.replace(pattern, `$1${mirror}`);
		writeFileSync(file, source);
		console.log(
			`prepare-android: prepended AliCloud mirrors to ${count} block(s) in ${file.slice(android.length + 1)}`,
		);
	}

	// The Android Gradle Plugin probes `dl.google.com/android/repository/addons_list-*.xml`
	// for SDK add-ons on every configure, even when every package is installed; from mainland
	// networks that probe fails and takes the whole build down. All required SDK packages are
	// installed already, so auto-download can be turned off outright.
	if (existsSync(gradleProperties)) {
		let props = readFileSync(gradleProperties, "utf8");
		if (!props.includes("android.builder.sdkDownload")) {
			if (!props.endsWith("\n")) props += "\n";
			writeFileSync(gradleProperties, `${props}android.builder.sdkDownload=false\n`);
			console.log("prepare-android: disabled AGP SDK auto-download (avoids the unreachable add-ons probe)");
		}
	}
}

function applySigning() {
	if (!existsSync(keystore)) {
		console.log(`prepare-android: no keystore at ${keystore}; release builds stay unsigned`);
		return;
	}
	const passwordFile = join(dirname(keystore), "keystore.password");
	const password =
		process.env.YONDER_ANDROID_KEYSTORE_PASSWORD ??
		(existsSync(passwordFile) ? readFileSync(passwordFile, "utf8").trim() : "");
	if (!password) {
		console.error(
			"prepare-android: set YONDER_ANDROID_KEYSTORE_PASSWORD or provide keystore.password next to the keystore",
		);
		process.exit(1);
	}

	writeFileSync(
		propertiesFile,
		[`storeFile=${keystore}`, `storePassword=${password}`, `keyAlias=${alias}`, `keyPassword=${password}`, ""].join(
			"\n",
		),
		{ mode: 0o600 },
	);

	let source = readFileSync(appGradle, "utf8");

	const propertiesBlock = `// Release signing: keystore.properties is written by apps/desktop/prepare-android.mjs
// (or from CI secrets) and never committed. Without it, release builds stay unsigned so
// local debug builds keep working on machines that hold no key.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
`;
	if (!source.includes("val keystoreProperties")) {
		if (!source.includes("android {\n")) {
			console.error("prepare-android: unexpected build.gradle.kts layout (no `android {` block)");
			process.exit(1);
		}
		source = source.replace("android {\n", `${propertiesBlock}\nandroid {\n`);
	}

	const signingBlock = `    signingConfigs {
        if (keystoreProperties.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
`;
	if (!source.includes('create("release")')) {
		if (!source.includes("    buildTypes {\n")) {
			console.error("prepare-android: unexpected build.gradle.kts layout (no `buildTypes {` block)");
			process.exit(1);
		}
		source = source.replace("    buildTypes {\n", `${signingBlock}    buildTypes {\n`);
	}

	if (!source.includes('signingConfig = signingConfigs.findByName("release")')) {
		const release = source.indexOf('getByName("release") {');
		if (release === -1) {
			console.error("prepare-android: unexpected build.gradle.kts layout (no release build type)");
			process.exit(1);
		}
		const insertAt = release + 'getByName("release") {'.length;
		source = `${source.slice(0, insertAt)}\n            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")${source.slice(insertAt)}`;
	}

	writeFileSync(appGradle, source);
	console.log(`prepare-android: release signing wired to ${keystore} (alias ${alias})`);
}

if (mirrors) applyMirrors();
applySigning();
