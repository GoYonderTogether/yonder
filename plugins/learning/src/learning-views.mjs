import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { skillStore } from "./skill-store.mjs";
import { editMemory, LIMITS, readMemory } from "./store.mjs";

const id = "learning.status";

export function createLearningViews(api, scopes, review) {
	const file = () => join(api.paths.data, "learning-changes.json");
	let queue = Promise.resolve(),
		rev = 0;
	async function load() {
		try {
			return JSON.parse(await readFile(file(), "utf8"));
		} catch (e) {
			if (e.code === "ENOENT") return [];
			throw e;
		}
	}
	async function save(records) {
		await mkdir(api.paths.data, { recursive: true });
		const temp = `${file()}.${randomUUID()}.tmp`;
		await writeFile(temp, JSON.stringify(records), { mode: 0o600 });
		await rename(temp, file());
		rev++;
		api.invalidate([id]);
	}
	function serialize(f) {
		const result = queue.then(f);
		queue = result.catch(() => {});
		return result;
	}
	async function scopeFor(session) {
		const info = await api.sessions.get(session);
		return scopes.find((s) => s.agent === info?.agent && s.profiles.includes(info.profile));
	}
	return {
		record(session, change) {
			return serialize(async () => {
				const records = await load();
				records.push({ id: randomUUID(), session, ...change });
				await save(records);
			});
		},
		register() {
			api.views.register(
				{
					id,
					plugin: api.id,
					title: "学习",
					placement: "page",
					scope: "session",
					actions: ["undo"],
					actScope: "owner",
				},
				{
					async data(session) {
						const scope = await scopeFor(session);
						const writable =
							scope &&
							((scope.writeMode === "exclusive-yonder" && (scope.memory !== false || scope.user !== false)) ||
								(scope.learning === true && !!scope.skillDir));
						const status = !scope ? "未配置 scope" : api.config?.enabled === false || !writable ? "只读" : "可学习";
						const result = await review.status(session);
						const records = (await load()).filter((r) => r.session === session);
						return {
							viewId: id,
							rev,
							content: {
								type: "list",
								items: [
									{
										id: "status",
										title: `状态：${status}`,
										subtitle: result ? JSON.stringify(result) : "暂无复盘结果",
									},
									...records.map((r) => ({
										id: r.id,
										title: `${r.kind}: ${r.target}`,
										subtitle: r.undone ? "已撤销" : (r.after ?? "已删除"),
										...(!r.undone ? { actions: [{ id: "undo", label: "撤销" }] } : {}),
									})),
								],
							},
						};
					},
					async act(action, input, session) {
						if (action !== "undo" || typeof input?.id !== "string") throw new Error("invalid_undo");
						return serialize(async () => {
							const scope = await scopeFor(session),
								records = await load();
							const change = records.find((r) => r.id === input.id && r.session === session && !r.undone);
							if (!scope || !change || api.config?.enabled === false) throw new Error("undo_unavailable");
							if (change.kind === "skill") {
								if (!scope.learning || !scope.skillDir) throw new Error("undo_unavailable");
								const current = await skillStore(scope.skillDir, {
									action: "read",
									name: change.target,
									file_path: change.path,
								});
								if (current.content !== change.after) throw new Error("conflict_external_change");
								let op;
								if (change.path === "SKILL.md" && change.before === null)
									op = { action: "archive", name: change.target, revision: current.revision };
								else if (change.path === "SKILL.md")
									op = { action: "patch", name: change.target, content: change.before, revision: current.revision };
								else if (change.before === null)
									op = {
										action: "remove_file",
										name: change.target,
										file_path: change.path,
										revision: current.revision,
									};
								else
									op = {
										action: "write_file",
										name: change.target,
										file_path: change.path,
										content: change.before,
										revision: current.revision,
									};
								await skillStore(scope.skillDir, op, undefined, { expectedTree: change.tree });
								change.undone = true;
								await save(records);
								return {};
							}
							if (change.kind !== "memory" || scope.writeMode !== "exclusive-yonder")
								throw new Error("undo_unavailable");
							const current = await readMemory(scope.memoryDir, change.target);
							if (change.after && !current.entries.includes(change.after)) throw new Error("conflict_external_change");
							if (change.before && current.entries.includes(change.before)) throw new Error("conflict_external_change");
							const op =
								change.before && change.after
									? { action: "patch", old_text: change.after, content: change.before }
									: change.after
										? { action: "remove", old_text: change.after }
										: { action: "add", content: change.before };
							await editMemory(
								scope.memoryDir,
								{ target: change.target, revision: current.revision, ...op },
								LIMITS[change.target],
							);
							change.undone = true;
							await save(records);
							return {};
						});
					},
				},
			);
		},
	};
}
