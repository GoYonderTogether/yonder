// Self-contained source runs on the ExecutionEnv host, never against this plugin host's filesystem.
// npm cmd-shim 8 and OpenAI's @openai/codex bin both use a plain Node entry, without shell arguments.
export const npmCodexEntrySource = String.raw`
function npmCodexEntry(shim) {
 const fs = require("node:fs"), path = require("node:path");
 const contents = fs.readFileSync(shim, "utf8");
 const matches = [...contents.matchAll(/"%_prog%"\s+"%(?:~dp0|dp0%)\\([^"\r\n]+)"\s+%\*/g)];
 if (matches.length !== 1 || !/SET "_prog=node"/i.test(contents)) throw new Error("Unsupported Codex shim; use the official npm Node entry or codex.exe.");
 const entry = path.resolve(path.dirname(shim), matches[0][1].replaceAll("\\", path.sep));
 const root = path.resolve(path.dirname(entry), "..");
 const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
 if (pkg.name !== "@openai/codex" || pkg.bin?.codex !== "bin/codex.js" ||
     path.resolve(root, pkg.bin.codex) !== entry || !fs.statSync(entry).isFile() ||
     !/^#!\/usr\/bin\/env node\r?\n/.test(fs.readFileSync(entry, "utf8")))
   throw new Error("Unsupported Codex shim target; expected @openai/codex bin/codex.js.");
 return entry;
}
`;

export const codexCommandProbe = `${npmCodexEntrySource}
const fs = require("node:fs"), path = require("node:path");
function command() {
 if (process.platform !== "win32") return ["codex"];
 const extensions = (process.env.PATHEXT || ".COM;.EXE;.CMD").split(";").filter(ext => /^\\.(exe|com|cmd)$/i.test(ext));
 for (const directory of (process.env.PATH || "").split(path.delimiter)) {
  if (!directory) continue;
  for (const extension of extensions) {
   const candidate = path.resolve(directory, "codex" + extension);
   if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
   return extension.toLowerCase() === ".cmd" ? [process.execPath, npmCodexEntry(candidate)] : [candidate];
  }
 }
 throw new Error("Codex CLI unavailable; install @openai/codex in the execution environment.");
}
try { process.stdout.write(JSON.stringify(command())); }
catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
`;
