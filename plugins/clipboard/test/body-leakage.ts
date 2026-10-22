/** Detects contiguous body-derived fragments of at least minCodePoints in serialized tool arguments. */
export function containsBodyFragment(text: string, body: string, minCodePoints = 16): boolean {
	const points = Array.from(body);
	if (points.length < minCodePoints) return false;
	const fragments = new Set<string>();
	for (let i = 0; i <= points.length - minCodePoints; i++) fragments.add(points.slice(i, i + minCodePoints).join(""));
	for (const fragment of fragments)
		if (text.includes(fragment) || text.includes(JSON.stringify(fragment).slice(1, -1))) return true;
	return false;
}
