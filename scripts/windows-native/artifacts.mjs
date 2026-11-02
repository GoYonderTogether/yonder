// Offline verification: native artifacts follow their sources, not unrelated release versions.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const NODE_VERSION = "22.19.0";
export const SOURCE_FILES = [
	"packages/sdk/native/windows-pipe.cc",
	"scripts/windows-native/artifacts.mjs",
	"scripts/windows-native/build.ps1",
];
export const ARCHITECTURES = ["x64", "arm64"];
const REPOSITORY = "https://github.com/GoYonderTogether/yonder";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function sourceIdentity(root = ROOT) {
	// Git checkouts on Windows may use CRLF; source identity uses canonical LF text.
	const files = SOURCE_FILES.map((path) => ({
		path,
		sha256: sha256(readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n")),
	}));
	return { files, sha256: sha256(JSON.stringify(files)) };
}

export function artifactDirectory(arch, root = ROOT) {
	if (!ARCHITECTURES.includes(arch)) throw new Error(`Unsupported Windows native architecture: ${arch}`);
	return join(root, "packages/sdk/native", `win32-${arch}`);
}

export function validateArtifact(manifest, binary, source, arch) {
	if (
		manifest?.format !== 1 ||
		manifest.interfaceVersion !== 1 ||
		manifest.platform !== "win32" ||
		manifest.arch !== arch ||
		!ARCHITECTURES.includes(arch) ||
		manifest.napiVersion !== 8 ||
		manifest.nodeVersion !== NODE_VERSION ||
		manifest.repository !== REPOSITORY
	)
		throw new Error("Windows native artifact metadata mismatch");
	if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "")) throw new Error("Missing native source commit");
	if (manifest.sourceSha256 !== source.sha256 || JSON.stringify(manifest.sources) !== JSON.stringify(source.files))
		throw new Error("Windows native sources changed; rebuild and commit both architecture artifacts");
	if (manifest.binarySha256 !== sha256(binary)) throw new Error("Windows native binary SHA256 mismatch");
	if (!/^[a-f0-9]{64}$/.test(manifest.headersSha256 ?? "") || !/^[a-f0-9]{64}$/.test(manifest.nodeLibrarySha256 ?? ""))
		throw new Error("Missing official Node build input hashes");
	if (
		!/^\d+(?:\.\d+){1,3}$/.test(manifest.msvcVersion ?? "") ||
		!/^\d+(?:\.\d+){1,3}$/.test(manifest.windowsSdkVersion ?? "")
	)
		throw new Error("Missing Windows compiler provenance");
	return manifest;
}

export function verifyArtifact(arch, root = ROOT) {
	const dir = artifactDirectory(arch, root);
	return validateArtifact(
		JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
		readFileSync(join(dir, "owner-pipe.node")),
		sourceIdentity(root),
		arch,
	);
}

function record(arch) {
	const dir = artifactDirectory(arch);
	const source = sourceIdentity();
	const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
	// A provenance record must describe committed build inputs, not a dirty checkout.
	execFileSync("git", ["diff", "--exit-code", "HEAD", "--", ...SOURCE_FILES], { cwd: ROOT, stdio: "inherit" });
	for (const file of SOURCE_FILES) execFileSync("git", ["ls-files", "--error-unmatch", file], { cwd: ROOT });
	const inputs = JSON.parse(readFileSync(join(ROOT, ".build/windows-native", arch, "inputs.json"), "utf8"));
	const manifest = {
		format: 1,
		interfaceVersion: 1,
		platform: "win32",
		arch,
		napiVersion: 8,
		nodeVersion: NODE_VERSION,
		repository: REPOSITORY,
		sourceCommit,
		sourceSha256: source.sha256,
		sources: source.files,
		binarySha256: sha256(readFileSync(join(dir, "owner-pipe.node"))),
		...inputs,
	};
	validateArtifact(manifest, readFileSync(join(dir, "owner-pipe.node")), source, arch);
	writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const [command = "verify", requestedArch] = process.argv.slice(2);
		if (!["verify", "record"].includes(command))
			throw new Error("Usage: artifacts.mjs verify [x64|arm64] | record <arch>");
		if (command === "record" && !requestedArch) throw new Error("record requires an architecture");
		for (const arch of requestedArch ? [requestedArch] : ARCHITECTURES) {
			const manifest = command === "record" ? record(arch) : verifyArtifact(arch);
			console.log(`${arch}: source=${manifest.sourceSha256} binary=${manifest.binarySha256}`);
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
