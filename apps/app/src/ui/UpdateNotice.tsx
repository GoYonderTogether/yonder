import { useEffect, useState } from "react";

export function UpdateNotice() {
	const [available, setAvailable] = useState(false);
	useEffect(() => {
		let active = true;
		const check = async () => {
			try {
				const response = await fetch("/console/version.json", { cache: "no-store" });
				if (!response.ok) return;
				const latest: unknown = await response.json();
				if (
					active &&
					latest &&
					typeof latest === "object" &&
					"version" in latest &&
					typeof latest.version === "string" &&
					"commit" in latest &&
					(typeof latest.commit === "string" || latest.commit === null) &&
					(latest.version !== import.meta.env.VITE_BUILD_VERSION || latest.commit !== import.meta.env.VITE_BUILD_COMMIT)
				)
					setAvailable(true);
			} catch {
				// A failed update check should not interrupt the current session.
			}
		};
		void check();
		const interval = window.setInterval(check, 5 * 60 * 1000);
		window.addEventListener("focus", check);
		return () => {
			active = false;
			window.clearInterval(interval);
			window.removeEventListener("focus", check);
		};
	}, []);
	if (!available) return null;
	return (
		<div
			role="status"
			className="fixed right-4 bottom-20 z-50 rounded-full bg-raised px-4 py-2 text-small shadow-float md:bottom-4"
		>
			有新版本，
			<button type="button" className="underline" onClick={() => window.location.reload()}>
				刷新
			</button>
		</div>
	);
}
