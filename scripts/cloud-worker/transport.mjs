import { once } from "node:events";
import { createServer } from "node:http";

/** Explicit loopback transport stub; never presented as a real model result. */
export async function modelTransport() {
	let mode = "reply";
	let requests = [];
	let sequence = 0;
	let lastCallId;
	const held = [];
	let toolCall;
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const part of request) raw += part;
		const body = JSON.parse(raw);
		const requestId = ++sequence;
		requests.push({ messages: body.messages, model: body.model }); // credentials and headers are never captured
		const toolResult =
			!!lastCallId && body.messages.some((message) => message.role === "tool" && message.tool_call_id === lastCallId);
		if (mode === "503" || mode === "503-reflect" || (["send-then-503", "tool-then-503"].includes(mode) && toolResult)) {
			response.writeHead(503, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					error: {
						message: mode === "503-reflect" ? String(request.headers.authorization) : "transport-test HTTP 503",
					},
				}),
			);
			return;
		}
		if (mode === "timeout") return;
		if (mode === "hold") await new Promise((done) => held.push(done));
		if (response.destroyed) return;
		const call =
			mode === "send-then-503" && !body.messages.some((message) => message.role === "tool")
				? {
						name: "message_send",
						arguments: JSON.stringify({
							to: "owner",
							via: "card",
							text: "transport-test must not send this intermediate reply",
						}),
					}
				: toolCall?.(body, { toolResult });
		if (call) lastCallId = `transport-call-${requestId}`;
		const text = mode === "empty" ? "" : "transport-test reply";
		response.writeHead(200, { "content-type": "text/event-stream" });
		for (const value of [
			{
				choices: [
					{
						index: 0,
						delta: call
							? {
									role: "assistant",
									tool_calls: [{ index: 0, id: `transport-call-${requestId}`, type: "function", function: call }],
								}
							: { role: "assistant", content: text },
						finish_reason: null,
					},
				],
			},
			{
				choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			},
		])
			response.write(
				`data: ${JSON.stringify({ id: "loopback-transport", model: "glm-5.3-flash", object: "chat.completion.chunk", created: 1, ...value })}\n\n`,
			);
		response.end("data: [DONE]\n\n");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
		mode(value) {
			mode = value;
			lastCallId = undefined;
		},
		tool(value) {
			toolCall = value;
		},
		release() {
			for (const done of held.splice(0)) done();
		},
		requests: () => requests,
		clear() {
			requests = [];
		},
		async close() {
			for (const done of held.splice(0)) done();
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
		},
	};
}
