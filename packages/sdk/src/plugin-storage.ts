export interface PluginFileEntry {
	name: string;
	type: "file" | "directory";
}
export interface PluginFileStat {
	type: "file" | "directory";
	size: number;
	mtimeMs: number;
}

/** Bound to one plugin and host tenant/Bot. Paths inside an opened tree are relative. */
export interface PluginFiles {
	/** Only filesystem hosts expose this for explicit, read-only legacy imports and local source capabilities. */
	readonly localRoot?: string;
	read(path: string): Promise<string | undefined>;
	write(path: string, text: string): Promise<void>;
	append(path: string, text: string): Promise<void>;
	list(path?: string): Promise<PluginFileEntry[]>;
	stat(path: string): Promise<PluginFileStat | undefined>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	/** Serial data changes in this tree; callback failure leaves no writes. Use the bound handle in the callback. */
	transaction<T>(change: (files: PluginFiles) => Promise<T>): Promise<T>;
}
export interface PluginStorage {
	/** Defaults to the existing plugin data directory; custom roots preserve configured local libraries. */
	open(root?: string): PluginFiles;
}
