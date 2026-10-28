/** In-memory `requestId` idempotency for sessions.submit (contracts §1.3: 10 minutes; lost on restart). */
const DEDUPE_MS = 10 * 60_000;
const submits = new Map<string, { at: number; receipt: Promise<{ event: string; session: string }> }>();
export function dedupe(
	session: string,
	requestId: string,
	run: () => Promise<{ event: string; session: string }>,
): Promise<{ event: string; session: string; deduped?: boolean }> {
	const now = Date.now();
	for (const [key, value] of submits) if (now - value.at > DEDUPE_MS) submits.delete(key);
	const key = `${session}\u0000${requestId}`;
	const hit = submits.get(key);
	if (hit) return hit.receipt.then((receipt) => ({ ...receipt, deduped: true }));
	const receipt = run();
	submits.set(key, { at: now, receipt });
	receipt.catch(() => submits.delete(key));
	return receipt;
}
