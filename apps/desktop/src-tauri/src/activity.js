(() => {
	if (location.hostname !== "127.0.0.1" || !location.pathname.startsWith("/console/")) return;
	let retry;
	const connect = () => {
		const url = new URL("/console/api/stream?v=1", location.href);
		url.protocol = "ws:";
		const socket = new WebSocket(url);
		let heartbeat;
		socket.onopen = () => {
			socket.send(JSON.stringify({ t: "sub", sub: "desktop-activity", method: "activity.watch", params: {} }));
			heartbeat = setInterval(() => socket.send(JSON.stringify({ t: "ping" })), 20000);
		};
		socket.onmessage = ({ data }) => {
			const frame = JSON.parse(data);
			if (frame.sub !== "desktop-activity") return;
			if (frame.t === "end") {
				socket.close();
				return;
			}
			if (
				frame.t === "ev" &&
				frame.type === "notification" &&
				typeof frame.data?.session === "string" &&
				typeof frame.data?.text === "string"
			) {
				window.__TAURI_INTERNALS__.invoke("show_notification", { session: frame.data.session, text: frame.data.text });
				return;
			}
			const summary = frame.t === "ready" ? frame.result : frame.type === "activity.summary" ? frame.data : null;
			if (Number.isInteger(summary?.running) && Number.isInteger(summary?.waiting)) {
				window.__TAURI_INTERNALS__.invoke("set_activity", { running: summary.running, waiting: summary.waiting });
			}
		};
		socket.onclose = () => {
			clearInterval(heartbeat);
			window.__TAURI_INTERNALS__.invoke("set_offline");
			retry = setTimeout(connect, 2000);
		};
	};
	connect();
	addEventListener("beforeunload", () => clearTimeout(retry));
})();
