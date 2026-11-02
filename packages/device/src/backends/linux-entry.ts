import type { BackendProvider } from "../backend-provider.js";
import { ExecutorStore } from "../store.js";
import { createHostProvider } from "./host.js";
import { createLinuxGuestProvider } from "./linux.js";

/** Select the built-in Linux backend using this executor home's stable device identity. */
export function createBackendProvider(options: { home: string }): BackendProvider {
	const store = new ExecutorStore(options.home);
	try {
		return createHostProvider(
			store.data.deviceId,
			"execution-only",
			process.platform === "linux" ? createLinuxGuestProvider(store.data.deviceId, "execution-only") : undefined,
		);
	} finally {
		store.close();
	}
}
