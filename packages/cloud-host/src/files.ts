import { posix } from "node:path";
import type { SourceDirectory } from "@yonder/bot-definition/source";
import type { Pool } from "pg";

const missing = (path: string) =>
	Object.assign(new Error(`No such virtual file or directory: ${path}`), { code: "ENOENT" });

/** A directory view scoped to one tenant/Bot; the shared pool is owned by the worker. */
export function postgresDirectory(pool: Pool, tenant: string, bot: string, root: string, prefix = ""): SourceDirectory {
	const pathOf = (path: string) => {
		const relative = posix.isAbsolute(path) ? posix.relative(root, path) : path;
		const normalized = posix.normalize(relative);
		if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\\"))
			throw new Error("Virtual workspace path escapes workspace");
		return posix.join(prefix, normalized) === "." ? "" : posix.join(prefix, normalized);
	};
	return {
		root,
		files: {
			async readFile(path) {
				const name = pathOf(path);
				const result = await pool.query<{ content: string }>(
					"SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path=$3",
					[tenant, bot, name],
				);
				if (!result.rows[0]) throw missing(path);
				return result.rows[0].content;
			},
			async writeFile(path, content) {
				const name = pathOf(path);
				if (!name) throw new Error("Virtual file path is required");
				await pool.query(
					`INSERT INTO bot_files(tenant_id,bot_id,path,content) VALUES($1,$2,$3,$4)
					ON CONFLICT(tenant_id,bot_id,path) DO UPDATE SET content=excluded.content,updated_at=now()`,
					[tenant, bot, name, content],
				);
			},
			async exists(path) {
				const name = pathOf(path);
				if (!name) return true;
				return (
					(
						await pool.query(
							"SELECT 1 FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND (path=$3 OR starts_with(path,$4)) LIMIT 1",
							[tenant, bot, name, `${name}/`],
						)
					).rowCount !== 0
				);
			},
			async list(path) {
				const name = pathOf(path);
				const directory = name ? `${name}/` : "";
				const result = await pool.query<{ name: string; directory: boolean }>(
					`SELECT split_part(substr(path,length($3)+1),'/',1) AS name,
					bool_or(strpos(substr(path,length($3)+1),'/')>0) AS directory
					FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND starts_with(path,$3) AND path<>$3
					GROUP BY 1 ORDER BY 1`,
					[tenant, bot, directory],
				);
				if (name && !result.rows.length && !(await this.exists(path))) throw missing(path);
				return result.rows.map((entry) => ({ name: entry.name, type: entry.directory ? "directory" : "file" }));
			},
		},
	};
}
