import { posix, win32 } from "node:path";
import type { WorkspaceResource } from "./workbench.js";

const inside = (root: string, path: string) => {
	const api = /^[a-z]:[\\/]|^\\\\/i.test(root) ? win32 : posix;
	const relative = api.relative(root, path);
	return !api.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${api.sep}`);
};

/** Undefined means inherited scope; a computed empty intersection is denied, never inherited. */
export function intersectResources(
	base: readonly WorkspaceResource[] | undefined,
	ceiling: readonly WorkspaceResource[] | undefined,
): WorkspaceResource[] | undefined {
	if ((base !== undefined && !base.length) || (ceiling !== undefined && !ceiling.length))
		throw new Error("No shared execution resources");
	if (base === undefined) return ceiling === undefined ? undefined : structuredClone([...ceiling]);
	if (ceiling === undefined) return structuredClone([...base]);
	const allowed: WorkspaceResource[] = [];
	for (const resource of base) {
		const other = ceiling.find((entry) => entry.deviceId === resource.deviceId);
		if (!other) continue;
		const paths = !resource.paths.length
			? [...other.paths]
			: !other.paths.length
				? [...resource.paths]
				: [
						...new Set(
							resource.paths.flatMap((a) => other.paths.flatMap((b) => (inside(a, b) ? [b] : inside(b, a) ? [a] : []))),
						),
					];
		if (resource.paths.length && other.paths.length && !paths.length) continue;
		allowed.push({ deviceId: resource.deviceId, paths });
	}
	if (!allowed.length) throw new Error("No shared execution resources");
	return allowed;
}
