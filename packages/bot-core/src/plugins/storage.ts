import type { PluginFiles, PluginStorage } from "@yonder/sdk";

/** Storage binding is inert during registration, just like the other stateful plugin services. */
export function guardStorage(storage: PluginStorage, deny: (operation: string) => void): PluginStorage {
	const handles = new WeakMap<PluginFiles, PluginFiles>();
	return {
		writeAttachment(path, bytes, mime) {
			deny("storage.writeAttachment");
			return storage.writeAttachment(path, bytes, mime);
		},
		open(root?: string) {
			const files = storage.open(root);
			let guarded = handles.get(files);
			if (!guarded) {
				guarded = new Proxy(files, {
					get(target, key, receiver) {
						const value = Reflect.get(target, key, receiver);
						if (typeof value !== "function") return value;
						return (...args: unknown[]) => {
							deny(`storage.${String(key)}`);
							return Reflect.apply(value, target, args);
						};
					},
				});
				handles.set(files, guarded);
			}
			return guarded;
		},
	};
}
