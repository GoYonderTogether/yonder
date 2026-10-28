import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Runs deploy/node/nginx-console.py as a pure transform over sample nginx configs.
const dirs = [];
const PY = join(import.meta.dirname, "..", "..", "deploy", "node", "nginx-console.py");

function runTransform(text, mode, port, originHost) {
	const dir = mkdtempSync(join(tmpdir(), "nginx-console-"));
	const file = join(dir, "yonder.conf");
	dirs.push(dir);
	writeFileSync(file, text);
	const r = spawnSync("python3", [PY, file], {
		env: { ...process.env, MODE: mode, PORT: port, ORIGIN_HOST: originHost },
		encoding: "utf8",
	});
	return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? ""), file };
}

afterAll(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ONE_SERVER = `server {
    listen 443 ssl;
    server_name console.example.com;
    location / {
        root /var/www/html;
    }
}
`;
const TWO_SERVERS = `server {
    listen 80;
    server_name api.example.com;
    location / {
        proxy_pass http://127.0.0.1:9000;
    }
}
server {
    listen 443 ssl;
    server_name console.example.com;
    location / {
        root /var/www/html;
    }
}
`;

describe("deploy/node/nginx-console.py", () => {
	it("inserts the marked block into a single-server config", () => {
		const { status, file } = runTransform(ONE_SERVER, "maint", "", "console.example.com");
		expect(status).toBe(0);
		const out = readFileSync(file, "utf8");
		expect(out).toContain("# yonder-console begin");
		expect(out).toContain("# yonder-console end");
		expect(out).toContain("alias /usr/share/nginx/yonder-console/;");
		// block lands inside the server block, before location /
		const begin = out.indexOf("# yonder-console begin");
		expect(begin).toBeGreaterThan(out.lastIndexOf("server_name console.example.com"));
		expect(begin).toBeLessThan(out.indexOf("location / {"));
	});

	it("inserts only into the server block matching the origin host", () => {
		const { status, file } = runTransform(TWO_SERVERS, "proxy", "8787", "console.example.com");
		expect(status).toBe(0);
		const out = readFileSync(file, "utf8");
		expect(out.match(/# yonder-console begin/g)).toHaveLength(1);
		expect(out).toContain("proxy_pass http://127.0.0.1:8787/;");
		// the api.example.com block stays untouched
		const apiBlock = out.slice(0, out.indexOf("server {", 1));
		expect(apiBlock).not.toContain("yonder-console");
	});

	it("prefers the TLS server over an http redirect server with the same name", () => {
		const conf = `server {
    listen 80;
    server_name console.example.com;
    return 308 https://console.example.com$request_uri;
}
${ONE_SERVER}`;
		const { status, file } = runTransform(conf, "proxy", "7690", "console.example.com");
		expect(status).toBe(0);
		const out = readFileSync(file, "utf8");
		expect(out.match(/# yonder-console begin/g)).toHaveLength(1);
		expect(out.indexOf("# yonder-console begin")).toBeGreaterThan(out.indexOf("listen 443 ssl;"));
	});

	it("is idempotent: rerunning does not duplicate the block", () => {
		const first = runTransform(ONE_SERVER, "maint", "", "console.example.com");
		expect(first.status).toBe(0);
		const second = runTransform(readFileSync(first.file, "utf8"), "maint", "", "console.example.com");
		expect(second.status).toBe(0);
		const out = readFileSync(second.file, "utf8");
		expect(out.match(/# yonder-console begin/g)).toHaveLength(1);
		expect(out.match(/location \/console\//g)).toHaveLength(1);
		// a mode switch replaces the block
		const third = runTransform(out, "proxy", "8787", "console.example.com");
		expect(third.status).toBe(0);
		const out3 = readFileSync(third.file, "utf8");
		expect(out3.match(/# yonder-console begin/g)).toHaveLength(1);
		expect(out3).toContain("proxy_pass http://127.0.0.1:8787/;");
		expect(out3).not.toContain("yonder-console/");
	});

	it("fails with non-zero exit when no server_name matches", () => {
		const { status, out, file } = runTransform(ONE_SERVER, "maint", "", "other.example.com");
		expect(status).not.toBe(0);
		expect(out).toContain("no server block with server_name");
		expect(readFileSync(file, "utf8")).toBe(ONE_SERVER); // nothing written
	});
});
