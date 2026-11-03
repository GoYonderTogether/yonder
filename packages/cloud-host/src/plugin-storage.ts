import { posix } from "node:path";
import type { PluginFiles, PluginStorage } from "@yonder/sdk";
import type { Pool, PoolClient } from "pg";

export const pluginStorageSchema = `CREATE TABLE IF NOT EXISTS plugin_files (
 tenant_id TEXT NOT NULL,bot_id TEXT NOT NULL,plugin_id TEXT NOT NULL,root TEXT NOT NULL,path TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('file','directory')),content TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,bot_id,plugin_id,root,path)
)`;
export async function migratePluginStorage(pool: Pool): Promise<void> {
	await pool.query(pluginStorageSchema);
}

export function createPostgresPluginStorage(pool: Pool, tenant: string, bot: string, plugin: string): PluginStorage {
	const opened = new Map<string, PluginFiles>();
	const storage: PluginStorage = {
		async writeAttachment(path, bytes, mime) {
			const uri = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
			await storage.open().write(path, uri);
			return uri;
		},
		open(root = "") {
			const existing = opened.get(root);
			if (existing) return existing;
			const scope = [tenant, bot, plugin, root];
			const pathOf = (path: string) => {
				const normalized = posix.normalize(path);
				if (posix.isAbsolute(path) || normalized === ".." || normalized.startsWith("../") || normalized.includes("\\"))
					throw new Error("Plugin file path escapes storage root");
				return normalized === "." ? "" : normalized;
			};
			const scopeWhere = "tenant_id=$1 AND bot_id=$2 AND plugin_id=$3 AND root=$4";
			function handle(db: Pool | PoolClient): PluginFiles {
				const files: PluginFiles = {
					async read(path) {
						const row = (
							await db.query<{ kind: string; content: string }>(
								`SELECT kind,content FROM plugin_files WHERE ${scopeWhere} AND path=$5`,
								[...scope, pathOf(path)],
							)
						).rows[0];
						if (row?.kind === "directory") throw new Error("Path is a directory");
						return row?.content;
					},
					async write(path, text) {
						path = pathOf(path);
						if (!path) throw new Error("Plugin file path is required");
						await db.query(
							`INSERT INTO plugin_files(tenant_id,bot_id,plugin_id,root,path,kind,content) VALUES($1,$2,$3,$4,$5,'file',$6)
				ON CONFLICT(tenant_id,bot_id,plugin_id,root,path) DO UPDATE SET kind='file',content=excluded.content,updated_at=now()`,
							[...scope, path, text],
						);
					},
					async append(path, text) {
						await files.transaction(async (tx) => {
							await tx.write(path, ((await tx.read(path)) ?? "") + text);
						});
					},
					async list(path = "") {
						const normalized = pathOf(path);
						const prefix = normalized ? `${normalized}/` : "";
						const rows = await db.query<{ name: string; directory: boolean }>(
							`SELECT split_part(substr(path,length($5)+1),'/',1) AS name,bool_or(kind='directory' OR strpos(substr(path,length($5)+1),'/')>0) AS directory
					FROM plugin_files WHERE ${scopeWhere} AND starts_with(path,$5) AND path<>$6 GROUP BY 1 ORDER BY 1`,
							[...scope, prefix, normalized],
						);
						return rows.rows.map(({ name, directory }) => ({ name, type: directory ? "directory" : "file" }));
					},
					async stat(path) {
						path = pathOf(path);
						if (!path) return { type: "directory", size: 0, mtimeMs: 0 };
						const row = (
							await db.query<{ kind: "file" | "directory"; size: number; at: number }>(
								`SELECT kind,octet_length(coalesce(content,'')) AS size,extract(epoch FROM updated_at)*1000 AS at FROM plugin_files WHERE ${scopeWhere} AND path=$5`,
								[...scope, path],
							)
						).rows[0];
						if (row) return { type: row.kind, size: row.size, mtimeMs: Number(row.at) };
						const child = (
							await db.query(`SELECT 1 FROM plugin_files WHERE ${scopeWhere} AND starts_with(path,$5) LIMIT 1`, [
								...scope,
								`${path}/`,
							])
						).rows.length;
						return child ? { type: "directory", size: 0, mtimeMs: 0 } : undefined;
					},
					async mkdir(path) {
						path = pathOf(path);
						if (path)
							await db.query(
								`INSERT INTO plugin_files(tenant_id,bot_id,plugin_id,root,path,kind) VALUES($1,$2,$3,$4,$5,'directory') ON CONFLICT DO NOTHING`,
								[...scope, path],
							);
					},
					async remove(path) {
						path = pathOf(path);
						if (!path) throw new Error("Cannot remove plugin storage root");
						await db.query(`DELETE FROM plugin_files WHERE ${scopeWhere} AND path=$5`, [...scope, path]);
					},
					transaction: (change) => change(files),
				};

				return files;
			}
			const files = handle(pool);
			files.transaction = async (change) => {
				const client = await pool.connect();
				try {
					await client.query("BEGIN");
					await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
						JSON.stringify(["plugin", ...scope]),
					]);
					const result = await change(handle(client));
					await client.query("COMMIT");
					return result;
				} catch (error) {
					await client.query("ROLLBACK");
					throw error;
				} finally {
					client.release();
				}
			};
			for (const method of ["write", "mkdir", "remove"] as const) {
				const mutation = files[method] as (...args: string[]) => Promise<void>;
				Object.assign(files, {
					[method]: (...args: string[]) => files.transaction((tx) => (tx[method] as typeof mutation)(...args)),
				});
			}

			opened.set(root, files);
			return files;
		},
	};
	return storage;
}
