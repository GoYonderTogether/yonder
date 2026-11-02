export type Lifecycle = { pluginId: string; stop(): Promise<void> };
export async function stopContributions(
	started: Lifecycle[],
	log: { error(message: string, data?: object): void },
): Promise<void> {
	let failure: unknown;
	for (const item of started.splice(0).reverse()) {
		try {
			await item.stop();
		} catch (error) {
			log.error("Plugin contribution failed to stop", { plugin: item.pluginId, error: String(error) });
			failure ??= error;
		}
	}
	if (failure) throw failure;
}
