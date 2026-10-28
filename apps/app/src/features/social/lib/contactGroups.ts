import type { Actor } from "../../../api/social";

const letters = "ABCDEFGHJKLMNOPQRSTWXYZ";
const bounds = [..."阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀"];
const collator = new Intl.Collator("zh-Hans-u-co-pinyin");
export function contactGroups(contacts: Actor[]) {
	const groups = new Map<string, Actor[]>();
	for (const actor of [...contacts].sort((a, b) => collator.compare(a.name, b.name))) {
		const c = [...actor.name.trim()][0] ?? "";
		let key = /[a-z]/i.test(c) ? c.toUpperCase() : "#";
		if (/[一-龥]/.test(c)) {
			let i = -1;
			bounds.forEach((b, n) => {
				if (collator.compare(b, c) <= 0) i = n;
			});
			key = letters[i] ?? "#";
		}
		groups.set(key, [...(groups.get(key) ?? []), actor]);
	}
	return [...groups].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
}
