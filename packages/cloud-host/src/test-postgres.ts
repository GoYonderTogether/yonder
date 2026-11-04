import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";

const binDir = () => process.env.TEST_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const binary = (name: string) => join(binDir(), name);

/**
 * Why the real-PostgreSQL tests cannot run on this machine; undefined when `initdb`/`pg_ctl` are found.
 * Tests needing a real server skip with this reason, the same way tests needing model credentials
 * skip without `YONDER_TEST_AUTH`; point `TEST_PG_BIN` at a PostgreSQL bin directory to enable them.
 */
export const testPostgresUnavailable = [binary("initdb"), binary("pg_ctl")].some((path) => !existsSync(path))
	? `PostgreSQL initdb/pg_ctl not found under ${binDir()} (set TEST_PG_BIN)`
	: undefined;

const run = (name: string, args: string[]) =>
	execFileSync(binary(name), args, {
		stdio: "pipe",
		timeout: 90000,
		env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" },
	});

export async function testPostgres() {
	const directory = mkdtempSync(join(tmpdir(), "yonder-definition-pg-"));
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	const pool = new Pool({ connectionString: `postgres://test@127.0.0.1:${port}/postgres`, max: 4 });
	let started = false;
	const close = async () => {
		await pool.end();
		if (started) run("pg_ctl", ["-D", directory, "-m", "immediate", "-w", "stop"]);
		rmSync(directory, { recursive: true, force: true });
	};
	try {
		run("initdb", ["-D", directory, "-U", "test", "-A", "trust", "--no-locale", "-E", "UTF8"]);
		run("pg_ctl", [
			"-D",
			directory,
			"-l",
			join(directory, "postgres.log"),
			"-o",
			`-h 127.0.0.1 -p ${port} -k ''`,
			"-w",
			"start",
		]);
		started = true;
		return { pool, close };
	} catch (error) {
		await close();
		throw error;
	}
}
