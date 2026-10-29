import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { type ConnState, mux } from "../api/stream";

export function Banner() {
	const [s, setS] = useState<ConnState>(mux.state);
	useEffect(() => mux.onState(setS), []);
	if (s !== "down") return null;
	return (
		<div
			role="status"
			className="pt-safe flex items-center justify-center gap-2 bg-danger px-3 py-1.5 text-small text-white"
			data-testid="offline-banner"
		>
			<WifiOff size={15} aria-hidden /> 连接已断开，正在重连…恢复后会自动补齐
		</div>
	);
}
