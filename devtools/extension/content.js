// Isolated world, top frame, loopback only. No DOM insertion, eval, credentials, or background server.
(() => {
	const origin = location.origin;
	if (
		!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
		!/^https?:$/.test(location.protocol)
	)
		return;
	const pending = new Map();
	const maxBytes = 1_000_000;
	const size = (value) =>
		new TextEncoder().encode(JSON.stringify(value)).byteLength;
	window.addEventListener("message", (event) => {
		const frame = event.data;
		if (
			event.source !== window ||
			event.origin !== origin ||
			!frame ||
			frame.source !== "r-state-tree:page" ||
			frame.version !== 1 ||
			typeof frame.instanceId !== "string" ||
			!/^[a-zA-Z0-9-]{1,100}$/.test(frame.instanceId)
		)
			return;
		if (frame.type === "ready") {
			void chrome.runtime
				.sendMessage({
					source: "r-state-tree:availability",
					instanceId: frame.instanceId,
				})
				.catch(() => {});
			return;
		}
		const item = pending.get(frame.id);
		if (!item) return;
		try {
			if (size(frame) > maxBytes) return;
		} catch {
			return;
		}
		if (
			item.type === "discover" &&
			frame.type === "instance" &&
			typeof frame.title === "string" &&
			frame.title.length <= 100 &&
			frame.url === origin
		) {
			if (item.instances.size < 100)
				item.instances.set(frame.instanceId, {
					instanceId: frame.instanceId,
					title: frame.title,
					url: origin,
				});
		} else if (
			item.type === "query" &&
			frame.type === "response" &&
			item.instanceId === frame.instanceId &&
			frame.response &&
			Object.keys(frame.response).length === 1 &&
			(Object.hasOwn(frame.response, "value") ||
				typeof frame.response.error === "string")
		) {
			clearTimeout(item.timer);
			pending.delete(frame.id);
			item.reply(frame.response);
		}
	});
	chrome.runtime.onMessage.addListener((message, sender, reply) => {
		if (
			sender.id !== chrome.runtime.id ||
			!message ||
			message.source !== "r-state-tree:panel"
		)
			return;
		if (!["discover", "query"].includes(message.type)) return;
		if (pending.size >= 32) {
			reply({ error: "Too many outstanding inspection requests" });
			return;
		}
		if (
			message.type === "query" &&
			(typeof message.instanceId !== "string" ||
				!/^[a-zA-Z0-9-]{1,100}$/.test(message.instanceId))
		)
			return;
		try {
			if (size(message) > maxBytes - 1024) {
				reply({ error: "Request exceeds transport byte limit" });
				return;
			}
		} catch {
			reply({ error: "Expected a JSON request" });
			return;
		}
		const id = crypto.randomUUID();
		const item = {
			type: message.type,
			instanceId: message.instanceId,
			reply,
			instances: new Map(),
		};
		item.timer = setTimeout(
			() => {
				pending.delete(id);
				reply(
					item.type === "discover"
						? { instances: [...item.instances.values()] }
						: {
								error:
									"App disconnected or inspection timed out. Control may already have run; inspect before retrying.",
							}
				);
			},
			message.type === "discover" ? 150 : 6000
		);
		pending.set(id, item);
		window.postMessage(
			{
				source: "r-state-tree:extension",
				version: 1,
				id,
				type: message.type,
				...(message.type === "query"
					? { instanceId: message.instanceId, request: message.request }
					: {}),
			},
			origin
		);
		return true;
	});
})();
