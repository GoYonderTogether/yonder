export const AGENT_HUES = [18, 52, 160, 205, 255, 315] as const;

export function agentHue(actor: { id: string }): number {
	return (
		AGENT_HUES[[...actor.id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % AGENT_HUES.length] ?? AGENT_HUES[0]
	);
}
