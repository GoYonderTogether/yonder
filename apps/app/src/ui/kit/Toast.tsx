import { useSyncExternalStore } from "react";

let current: { id: number; text: string; error: boolean } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};
export function toast(text: string, error = false) {
	clearTimeout(timer);
	current = { id: Date.now(), text, error };
	emit();
	timer = setTimeout(() => {
		current = null;
		emit();
	}, 2200);
}
export function Toaster() {
	const t = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
		() => null,
	);
	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-8"
		>
			{t && (
				<div
					key={t.id}
					role="status"
					className={`rise rounded-full bg-raised px-4 py-2.5 text-small shadow-float ${t.error ? "text-danger" : "text-ink"}`}
				>
					{t.text}
				</div>
			)}
		</div>
	);
}
