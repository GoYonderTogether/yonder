import type { BackendProvider } from "../backend-provider.js";
import { ExecutorStore } from "../store.js";
import { createLinuxGuestProvider } from "./linux.js";

/** Select the built-in Linux backend using this executor home's stable device identity. */
export function createBackendProvider(options: { home: string }): BackendProvider {
	if (process.platform !== "linux") throw new Error("UNSUPPORTED_OPERATION");
	const store = new ExecutorStore(options.home);
	try {
		return createLinuxGuestProvider(store.data.deviceId, "execution-only");
	} finally {
		store.close();
	}
}
