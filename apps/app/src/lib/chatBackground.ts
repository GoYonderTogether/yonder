import { type CSSProperties, useEffect, useState } from "react";
export const BACKGROUND_PRESETS = [
	{ id: "default", label: "默认", color: undefined },
	{ id: "sage", label: "青雾", color: "#eaf0e9" },
	{ id: "sand", label: "暖沙", color: "#f1ede3" },
	{ id: "dusk", label: "暮色", color: "#e9eaf2" },
] as const;
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number]["id"];
export type ChatBackground = { kind: "preset"; preset: BackgroundPreset } | { kind: "image"; image: Blob };
export const DEFAULT_CHAT_BACKGROUND: ChatBackground = { kind: "preset", preset: "default" };
const DB = "yonder-chat-appearance",
	STORE = "backgrounds";
const listeners = new Set<(key: string) => void>();
export const chatBackgroundKey = (accountId: string, convId: string) => [accountId, convId];
const identity = (accountId: string | undefined, convId: string) => JSON.stringify([accountId, convId]);
export function backgroundStorageError() {
	return "无法保存或读取本机背景，请检查浏览器存储权限和剩余空间后重试。";
}
function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error(backgroundStorageError()));
			return;
		}
		const request = indexedDB.open(DB, 1);
		let rejected = false;
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
		};
		request.onsuccess = () => {
			if (rejected) request.result.close();
			else resolve(request.result);
		};
		request.onerror = () => reject(new Error(backgroundStorageError()));
		request.onblocked = () => {
			rejected = true;
			reject(new Error("请关闭其他旧页面后重试背景设置。"));
		};
	});
}
function validBackground(value: unknown): value is ChatBackground {
	if (!value || typeof value !== "object" || !("kind" in value)) return false;
	if (value.kind === "preset") return "preset" in value && BACKGROUND_PRESETS.some((p) => p.id === value.preset);
	return value.kind === "image" && "image" in value && value.image instanceof Blob;
}
async function transact<T>(
	accountId: string,
	convId: string,
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore, key: string[]) => IDBRequest<T>,
): Promise<T> {
	if (!accountId || !convId) throw new Error("请先登录后设置聊天背景");
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		let transaction: IDBTransaction;
		try {
			transaction = db.transaction(STORE, mode);
			const request = operation(transaction.objectStore(STORE), chatBackgroundKey(accountId, convId));
			transaction.oncomplete = () => {
				db.close();
				resolve(request.result);
			};
			transaction.onerror = transaction.onabort = () => {
				db.close();
				reject(new Error(backgroundStorageError()));
			};
		} catch {
			db.close();
			reject(new Error(backgroundStorageError()));
		}
	});
}
export async function loadChatBackground(accountId: string, convId: string): Promise<ChatBackground> {
	const value = await transact<unknown>(accountId, convId, "readonly", (store, key) => store.get(key));
	return validBackground(value) ? value : DEFAULT_CHAT_BACKGROUND;
}
export function validateBackgroundFile(file: Blob) {
	if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024)
		return "请选择不超过 5 MB 的 JPEG、PNG 或 WebP 图片";
	return undefined;
}
export async function saveChatBackground(accountId: string, convId: string, value: ChatBackground) {
	if (!validBackground(value)) throw new Error("请选择有效的聊天背景");
	if (value.kind === "image") {
		const error = validateBackgroundFile(value.image);
		if (error) throw new Error(error);
	}
	if (value.kind === "preset" && value.preset === "default")
		await transact(accountId, convId, "readwrite", (store, key) => store.delete(key));
	else await transact(accountId, convId, "readwrite", (store, key) => store.put(value, key));
	for (const listener of listeners) listener(identity(accountId, convId));
}
export async function validateBackgroundImage(file: Blob) {
	const error = validateBackgroundFile(file);
	if (error) throw new Error(error);
	const url = URL.createObjectURL(file);
	try {
		await new Promise<void>((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("图片无法读取，请选择其他图片"));
			image.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}
export function backgroundStyle(value: ChatBackground, url?: string): CSSProperties {
	if (value.kind === "image")
		return url
			? {
					backgroundImage: `url(${JSON.stringify(url)})`,
					backgroundSize: "cover",
					backgroundPosition: "center",
					backgroundRepeat: "no-repeat",
				}
			: {};
	const color = BACKGROUND_PRESETS.find((p) => p.id === value.preset)?.color;
	return color ? { backgroundColor: color } : {};
}
export function useBackgroundPreview(value: ChatBackground) {
	const image = value.kind === "image" ? value.image : undefined;
	const [object, setObject] = useState<{ image: Blob; url: string }>();
	useEffect(() => {
		if (!image) return;
		const url = URL.createObjectURL(image);
		setObject({ image, url });
		return () => URL.revokeObjectURL(url);
	}, [image]);
	return backgroundStyle(value, image && object?.image === image ? object.url : undefined);
}
/** Backgrounds never cross identity boundaries, including the render before a new read completes. */
export function useChatBackground(accountId: string | undefined, convId: string) {
	const key = identity(accountId, convId);
	const [state, setState] = useState<{ key: string; value: ChatBackground; loading: boolean; error?: string }>({
		key,
		value: DEFAULT_CHAT_BACKGROUND,
		loading: !!accountId,
	});
	useEffect(() => {
		let live = true,
			revision = 0;
		const refresh = async () => {
			const current = ++revision;
			if (!accountId) {
				setState({ key, value: DEFAULT_CHAT_BACKGROUND, loading: false });
				return;
			}
			setState((previous) => ({
				key,
				value: previous.key === key ? previous.value : DEFAULT_CHAT_BACKGROUND,
				loading: true,
			}));
			try {
				const value = await loadChatBackground(accountId, convId);
				if (live && current === revision) setState({ key, value, loading: false });
			} catch {
				if (live && current === revision)
					setState((previous) => ({
						key,
						value: previous.key === key ? previous.value : DEFAULT_CHAT_BACKGROUND,
						loading: false,
						error: backgroundStorageError(),
					}));
			}
		};
		const changed = (changedKey: string) => {
			if (changedKey === key) void refresh();
		};
		listeners.add(changed);
		void refresh();
		return () => {
			live = false;
			listeners.delete(changed);
		};
	}, [accountId, convId, key]);
	const current = state.key === key ? state : { key, value: DEFAULT_CHAT_BACKGROUND, loading: !!accountId };
	const style = useBackgroundPreview(current.value);
	return {
		...current,
		style,
		reload: () => {
			for (const listener of listeners) listener(key);
		},
	};
}
