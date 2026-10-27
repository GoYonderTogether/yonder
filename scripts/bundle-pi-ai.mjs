// Bundle a built fork artifact into the Git source release; never publish or patch node_modules.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = process.argv[2];
if (!manifestPath || process.argv.length !== 3)
	throw new Error("Usage: node scripts/bundle-pi-ai.mjs <pi-artifact-manifest.json>");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fork = JSON.parse(readFileSync(resolve(root, "packages/pi-durable/FORK_SOURCE.json"), "utf8"));
if (manifest.schemaVersion !== 1 || manifest.source?.commit !== fork.commit || manifest.source?.dirty !== false)
	throw new Error("Artifact source must be the clean, exact durable fork commit");
const artifact = manifest.packages?.find((pkg) => pkg.name === "@earendil-works/pi-ai");
if (artifact?.version !== "1.3.0" || typeof artifact.tarball !== "string") throw new Error("Unexpected pi-ai artifact");
const input = resolve(dirname(manifestPath), artifact.tarball);
const digest = createHash("sha512").update(readFileSync(input)).digest();
if (`sha512-${digest.toString("base64")}` !== artifact.integrity) throw new Error("pi-ai integrity mismatch");
const pkg = JSON.parse(execFileSync("tar", ["-xOf", input, "package/package.json"], { encoding: "utf8" }));
if (pkg.name !== artifact.name || pkg.version !== artifact.version) throw new Error("Packed package identity mismatch");
const filename = `pi-ai-${fork.commit}-${digest.toString("hex").slice(0, 12)}.tgz`;
const directory = resolve(root, "third_party/pi-ai");
mkdirSync(directory, { recursive: true });
copyFileSync(input, resolve(directory, filename));
copyFileSync(resolve(root, "packages/pi-durable/LICENSE"), resolve(directory, "LICENSE"));
writeFileSync(
	resolve(directory, "FORK_SOURCE.json"),
	`${JSON.stringify(
		{
			...fork,
			package: pkg.name,
			version: pkg.version,
			tarball: filename,
			integrity: artifact.integrity,
			artifactSource: manifest.source,
		},
		null,
		"\t",
	)}\n`,
);
const packagePath = resolve(root, "package.json");
const project = JSON.parse(readFileSync(packagePath, "utf8"));
project.dependencies = { ...project.dependencies, [pkg.name]: `file:./third_party/pi-ai/${filename}` };
project.overrides = { ...project.overrides, [pkg.name]: `$${pkg.name}` };
writeFileSync(packagePath, `${JSON.stringify(project, null, "\t")}\n`);
console.log(`Bundled ${pkg.name}@${pkg.version} from ${fork.commit}; ${artifact.integrity}`);
console.log("Next: npm install --package-lock-only --ignore-scripts && npm ci --ignore-scripts");
