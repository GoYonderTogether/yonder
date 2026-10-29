import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
	...(await original<typeof import("node:os")>()),
	homedir: () => fixture.home,
}));

import { manageService } from "./index.js";

test.skipIf(process.platform !== "darwin")(
	"service install/stop/start/restart/rollback contracts use one existing launchd job and wait for bootout",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "yonder-host-contract-"));
		fixture.home = root;
		const install = join(root, "install"),
			home = join(root, "data"),
			bin = join(root, "tools");
		const before = { path: process.env.PATH, install: process.env.YONDER_INSTALL };
		try {
			await mkdir(join(install, "bin"), { recursive: true });
			await mkdir(join(install, "current/scripts"), { recursive: true });
			await mkdir(join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS"), { recursive: true });
			await mkdir(home);
			await mkdir(bin);
			await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
			await writeFile(join(install, "bin/yonder"), "");
			await writeFile(
				join(install, "current/scripts/yonder-service-host.mjs"),
				"// Prepared artifact fixture; never executed.\n",
			);
			await writeFile(join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus"), "");
			const log = join(root, "calls.jsonl"),
				state = join(root, "registered.json");
			// A pure command-contract fixture: this script never invokes launchctl.
			await writeFile(
				join(bin, "launchctl"),
				`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
let jobs=[];try{jobs=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'))}catch{}
if(a[0]==='print'){if(!jobs.includes(a[1]))process.exit(1);console.log('state = running');if(process.env.YONDER_HOST_CONTRACT_PID)console.log('pid = '+process.env.YONDER_HOST_CONTRACT_PID);}
else if(a[0]==='bootstrap'){jobs.push(a[1]+'/'+path.basename(a[2],'.plist'));}
else if(a[0]==='bootout'){jobs=jobs.filter(j=>j!==a[1]);}
fs.writeFileSync(${JSON.stringify(state)},JSON.stringify(jobs));
`,
			);
			await chmod(join(bin, "launchctl"), 0o700);
			process.env.PATH = `${bin}:${before.path}`;
			process.env.YONDER_INSTALL = install;
			await manageService("install", { home });
			const plist = join(root, "Library/LaunchAgents/dev.yonder.harness.plist");
			expect(await readFile(plist, "utf8")).toContain("bin/yonder-service</string>");
			expect(await readFile(join(install, "bin/yonder-service"), "utf8")).toContain(
				"current/scripts/yonder-service-host.mjs",
			);

			process.env.YONDER_HOST_CONTRACT_PID = "424242";
			await writeFile(
				join(home, ".yonder/service-host.json"),
				JSON.stringify({ launcherPid: 424242, nodePid: process.pid, updatedAt: Date.now() }),
			);
			expect(await manageService("status")).toMatchObject({ pid: process.pid, launcherPid: 424242 });
			await writeFile(
				join(home, ".yonder/service-host.json"),
				JSON.stringify({ launcherPid: 424242, nodePid: process.pid, updatedAt: 0 }),
			);
			expect(await manageService("status")).toMatchObject({ pid: 424242, launcherPid: 424242 });
			delete process.env.YONDER_HOST_CONTRACT_PID;
			await manageService("stop");
			await manageService("start");
			await manageService("restart");
			const calls = (await readFile(log, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[]);
			const main = `gui/${process.getuid?.()}/dev.yonder.harness`;
			expect(calls.filter((c) => c[0] === "bootout" && c[1] === main)).toHaveLength(2);
			expect(calls.some((c) => c[0] === "kickstart" && c.includes("-k") && c.at(-1) === main)).toBe(false);
			// A rollback to an older product artifact without host support restores
			// the original wrapper argv instead of launching a missing host script.
			await rm(join(install, "current/scripts/yonder-service-host.mjs"));
			await manageService("install", { home });
			expect(await readFile(plist, "utf8")).toContain("<string>start</string>");
			expect(await readFile(plist, "utf8")).not.toContain("bin/yonder-service</string>");
			await manageService("uninstall");
		} finally {
			delete process.env.YONDER_HOST_CONTRACT_PID;
			if (before.path === undefined) delete process.env.PATH;
			else process.env.PATH = before.path;
			if (before.install === undefined) delete process.env.YONDER_INSTALL;
			else process.env.YONDER_INSTALL = before.install;
			await rm(root, { recursive: true, force: true });
		}
	},
);
