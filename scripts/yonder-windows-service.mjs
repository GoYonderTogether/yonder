import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

const [home, install, savedPath] = process.argv.slice(2);
if (process.platform !== "win32" || !home || !install) throw new Error("Windows service requires home and install");
await mkdir(join(home, ".yonder/logs"), { recursive: true });
const log = await open(join(home, ".yonder/logs/harness.log"), "a");
const child = spawn(
	process.execPath,
	[join(install, "current/packages/cli/dist/index.js"), "start", "--home", home, "--json"],
	{
		windowsHide: true,
		stdio: ["ignore", log.fd, log.fd],
		env: {
			...process.env,
			YONDER_HOME: home,
			YONDER_INSTALL: install,
			PATH: [join(install, "bin"), dirname(process.execPath), savedPath].filter(Boolean).join(delimiter),
		},
	},
);
child.once("error", async (error) => {
	console.error(error);
	await log.close();
	process.exitCode = 1;
});
child.once("exit", async (code) => {
	await log.close();
	process.exitCode = code ?? 1;
});
