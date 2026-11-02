/** Resume recovered work only after both input sources have been collected. */
export async function resumeRecovered(
	delivery: { recover(): Promise<void> },
	router: { recover(): Promise<Array<() => void>> },
	sessions: { recover(): Promise<Array<() => void>> },
	runtime: { recover(): Promise<void>; resume(): void },
) {
	await delivery.recover();
	await runtime.recover();
	const pending = [...(await router.recover()), ...(await sessions.recover())];
	runtime.resume();
	for (const submit of pending) submit();
}
