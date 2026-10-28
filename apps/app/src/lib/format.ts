export function clock(iso?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const now = new Date();
	const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = (day(now) - day(d)) / 86_400_000;
	const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	if (diff === 0) return hm;
	if (diff === 1) return "昨天";
	if (diff < 7) return `周${"日一二三四五六"[d.getDay()]}`;
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 1234 → 1.2k，与 pi footer 一致 */
export function tokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export function badge(n: number): string {
	return n > 99 ? "99+" : String(n);
}

export function hue(seed: string): number {
	let h = 0;
	for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
	return h;
}
