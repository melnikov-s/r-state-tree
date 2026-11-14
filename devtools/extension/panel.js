// Extension-page renderer. Application data is text, never HTML or executable source.
(() => {
	const $ = (id) => document.getElementById(id);
	const tabId = chrome.devtools.inspectedWindow.tabId;
	let instanceId = "",
		rootId = "",
		path = [],
		controls = false,
		generation = 0,
		history = false;
	const node = (tag, text) => {
		const element = document.createElement(tag);
		if (text !== undefined) element.textContent = text;
		return element;
	};
	const status = (text, error = false) => {
		$("status").textContent = text;
		$("status").className = error ? "error" : "";
	};
	const message = async (data) => {
		try {
			return await chrome.tabs.sendMessage(
				tabId,
				{ source: "r-state-tree:panel", ...data },
				{ frameId: 0 }
			);
		} catch {
			throw new Error(
				"No development bridge. Start the local Vite app, register roots, then reload the app and reconnect. This extension supports Chromium loopback pages only."
			);
		}
	};
	const query = async (request) => {
		const version = generation,
			target = instanceId;
		const response = await message({
			type: "query",
			instanceId: target,
			request,
		});
		if (version !== generation || instanceId !== target)
			throw new Error(
				"Selection changed while inspection was pending; stale reply discarded. Controls are never retried."
			);
		if (!response || response.error)
			throw new Error(response?.error || "App did not reply");
		const value = response.value;
		if (value?.ok === false || value?.errors?.length)
			throw new Error(
				value.error ||
					"Child initialization failed. Successful partial effects may already have happened."
			);
		return value;
	};
	const action = (label, work) => {
		const button = node("button", label);
		button.type = "button";
		const version = generation;
		button.onclick = async () => {
			if (version !== generation) return;
			button.disabled = true;
			try {
				await work();
			} catch (error) {
				if (version === generation) status(error.message, true);
			} finally {
				button.disabled = false;
			}
		};
		return button;
	};
	const valueText = (value) => {
		if (value === null || typeof value !== "object")
			return JSON.stringify(value);
		const labels = {
			uninitialized: "Not initialized",
			deferred: "Not evaluated",
			redacted: "Redacted",
			error: "Evaluation failed",
			truncated: "Limit reached",
			unsupported: "Not inspectable",
			reference: "Reference",
		};
		return labels[value.kind] || value.className || value.kind || "Object";
	};
	const navigable = (value) =>
		value &&
		typeof value === "object" &&
		value.id &&
		["Store", "Model", "Observable", "object", "array", "reference"].includes(
			value.kind
		);
	const selectPath = async (next) => {
		path = next;
		history = false;
		await refreshState();
	};
	const contextValue = (value) => {
		const pre = node("pre", JSON.stringify(value, null, 2));
		return pre;
	};
	const renderState = (value) => {
		const container = $("state");
		container.replaceChildren();
		$("selection").textContent = [
			$("roots").querySelector("[aria-current]")?.textContent || "Root",
			...path,
		].join(" / ");
		$("up").disabled = !path.length;
		if (!value || typeof value !== "object" || !value.fields) {
			container.append(node("p", valueText(value)));
			return;
		}
		const identity = node(
			"p",
			`${value.className || value.kind} · ${value.id}`
		);
		identity.className = "meta";
		if (value.parentId) identity.append(` · parent ${value.parentId}`);
		if (
			value.key !== undefined &&
			(value.key === null || typeof value.key !== "object")
		)
			identity.append(` · key ${JSON.stringify(value.key)}`);
		container.append(identity);
		if (value.truncated)
			container.append(
				node("p", "Output limited; select a subtree for more detail.")
			);
		const table = node("table");
		const head = node("tr");
		["Field / relationship", "Live value", "Explicit actions"].forEach(
			(label) => head.append(node("th", label))
		);
		const thead = node("thead");
		thead.append(head);
		table.append(thead);
		const tbody = node("tbody");
		table.append(tbody);
		for (const field of value.fields) {
			const row = node("tr");
			row.dataset.field = field.name;
			const name = node("td", field.name);
			const meta = node("span", `${field.type} · ${field.edge}`);
			meta.className = "meta";
			name.append(meta);
			const data = node("td");
			data.append(node("code", valueText(field.value)));
			const actions = node("td");
			if (navigable(field.value))
				actions.append(
					action(`Inspect ${field.name}`, () =>
						selectPath([...path, field.name])
					)
				);
			if (field.value?.kind === "uninitialized") {
				actions.append(
					action(`Initialize ${field.name}`, async () => {
						const result = await query({
							op: "initialize",
							rootId,
							path,
							field: field.name,
							levels: 1,
							maxInitializations: 1,
						});
						await refreshState();
						status(`Initialized ${result.initialized} child field(s).`);
					})
				);
			}
			if (controls && field.writable) {
				const details = node("details");
				details.append(node("summary", `Edit ${field.name}`));
				const input = node("textarea");
				input.setAttribute("aria-label", `JSON value for ${field.name}`);
				input.value =
					field.value === null || typeof field.value !== "object"
						? JSON.stringify(field.value)
						: "null";
				details.append(
					input,
					action(`Set ${field.name}`, async () => {
						const value = JSON.parse(input.value);
						await query({ op: "set", rootId, path, field: field.name, value });
						await refreshState();
						status("Field updated. No automatic retry.");
					})
				);
				actions.append(details);
			}
			row.append(name, data, actions);
			tbody.append(row);
		}
		container.append(table);
		if (value.methods?.length) {
			container.append(
				node(
					"h2",
					controls
						? "Application methods · controls enabled"
						: "Supported methods · read-only"
				)
			);
			for (const method of value.methods) {
				const item = node("div");
				item.className = "method";
				item.dataset.method = method.name;
				item.append(
					node(
						"code",
						`${method.name}(${method.parameters?.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type || p.kind || "unknown"}`).join(", ") || "signature unavailable"})${method.returnType ? ` → ${method.returnType}` : ""}`
					)
				);
				if (controls) {
					const details = node("details");
					details.append(node("summary", `Configure ${method.name}`));
					details.append(
						node(
							"p",
							"JSON positional arguments. Calls may change real app state or services; no rollback or automatic retry."
						)
					);
					const input = node("textarea");
					input.value = "[]";
					input.setAttribute("aria-label", `JSON arguments for ${method.name}`);
					details.append(
						input,
						action(`Call ${method.name}`, async () => {
							const args = JSON.parse(input.value);
							if (!Array.isArray(args))
								throw new Error(
									"Expected a JSON array of positional arguments"
								);
							const result = await query({
								op: "call",
								rootId,
								path,
								method: method.name,
								args,
							});
							await refreshState();
							status(`Returned: ${valueText(result.result)}`);
						})
					);
					item.append(details);
				}
				container.append(item);
			}
		}
		if (value.contexts?.length) {
			container.append(node("h2", "Available Context · explicit reads only"));
			for (const context of value.contexts) {
				const item = node("div", `${context.name} · ${context.status}`);
				if (!["redacted", "unavailable"].includes(context.status))
					item.append(
						action(`Read Context ${context.name}`, async () => {
							const result = await query({
								op: "context",
								rootId,
								path,
								contextId: context.contextId,
							});
							item.querySelector("pre")?.remove();
							item.append(contextValue(result.result));
						})
					);
				container.append(item);
			}
		}
	};
	const refreshState = async () => {
		const version = ++generation;
		$("state").hidden = history;
		$("history").hidden = !history;
		if (!rootId && !history) {
			$("state").replaceChildren();
			return;
		}
		const value = await query(
			history
				? { op: "operations" }
				: {
						op: "inspect",
						rootId,
						path,
						depth: 2,
						maxEntries: 200,
						evaluateComputeds: $("computeds").checked,
					}
		);
		if (version !== generation) return;
		if (history) {
			$("history").replaceChildren(
				node("h2", "Observed operations"),
				node(
					"p",
					value.enabled
						? "Bounded optional activity; not an exhaustive execution trace."
						: "Recording is disabled in the app. Enable activity or attach an operation timeline in development."
				),
				contextValue(value)
			);
			if (value.canClear)
				$("history").append(
					action("Clear operations", async () => {
						await query({ op: "clearOperations" });
						await refreshState();
					})
				);
		} else renderState(value);
		status("Connected · live snapshot. Refresh to observe changes.");
	};
	const loadRoots = async () => {
		const version = ++generation;
		rootId = "";
		path = [];
		history = false;
		$("state").replaceChildren();
		$("history").replaceChildren();
		$("roots").replaceChildren();
		$("mode").textContent = "";
		let value;
		try {
			value = await query({ op: "roots" });
		} catch (error) {
			if (version === generation) status(error.message, true);
			return;
		}
		if (version !== generation) return;
		controls = value.controls === true;
		$("mode").textContent = controls
			? "Controls explicitly enabled by app"
			: "Read-only · controls disabled";
		for (const root of value.roots) {
			const button = node("button", `${root.name} · ${root.kind}`);
			button.onclick = async () => {
				for (const other of $("roots").children)
					other.removeAttribute("aria-current");
				button.setAttribute("aria-current", "page");
				rootId = root.rootId;
				path = [];
				history = false;
				try {
					await refreshState();
				} catch (error) {
					status(error.message, true);
				}
			};
			$("roots").append(button);
		}
		status(
			value.roots.length
				? "Select a registered root."
				: "Connected; no registered roots."
		);
	};
	const reconnect = async () => {
		const version = ++generation;
		const previous = instanceId;
		instanceId = "";
		rootId = "";
		path = [];
		$("state").replaceChildren();
		$("history").replaceChildren();
		$("roots").replaceChildren();
		$("instances").replaceChildren();
		$("mode").textContent = "";
		try {
			const result = await message({ type: "discover" });
			if (version !== generation) return;
			if (!result?.instances?.length)
				throw new Error(
					"No registered development bridge. Keep setup behind import.meta.hot and call connectViteInspector; reload the app after installing this extension."
				);
			const choose = node(
				"option",
				result.instances.length > 1
					? "Select a running instance"
					: "Select instance"
			);
			choose.value = "";
			$("instances").append(choose);
			for (const instance of result.instances) {
				const option = node(
					"option",
					`${instance.title || "RStateTree"} · ${instance.url} · ${instance.instanceId.slice(0, 8)}`
				);
				option.value = instance.instanceId;
				$("instances").append(option);
			}
			instanceId =
				result.instances.find((i) => i.instanceId === previous)?.instanceId ||
				(result.instances.length === 1 ? result.instances[0].instanceId : "");
			$("instances").value = instanceId;
			if (instanceId) await loadRoots();
			else
				status(
					"Multiple registered bridges; select a running instance explicitly."
				);
		} catch (error) {
			if (version === generation) status(error.message, true);
		}
	};
	$("instances").onchange = async () => {
		instanceId = $("instances").value;
		if (!instanceId) {
			++generation;
			$("state").replaceChildren();
			$("roots").replaceChildren();
			return;
		}
		try {
			await loadRoots();
		} catch (error) {
			status(error.message, true);
		}
	};
	$("refresh").onclick = async () => {
		try {
			if (rootId) await refreshState();
			else await reconnect();
		} catch (error) {
			++generation;
			rootId = "";
			$("state").replaceChildren();
			status(`${error.message} Use Reconnect / refresh to rediscover.`, true);
		}
	};
	$("up").onclick = () =>
		selectPath(path.slice(0, -1)).catch((error) => status(error.message, true));
	$("computeds").onchange = () => {
		if (rootId) refreshState().catch((error) => status(error.message, true));
	};
	$("operations").onclick = () => {
		history = !history;
		refreshState().catch((error) => status(error.message, true));
	};
	chrome.devtools.network.onNavigated.addListener(() => {
		void reconnect();
	});
	chrome.runtime.onMessage.addListener((message, sender) => {
		if (
			sender.id === chrome.runtime.id &&
			sender.tab?.id === tabId &&
			message?.source === "r-state-tree:availability" &&
			(!instanceId || message.instanceId !== instanceId)
		)
			void reconnect();
	});
	void reconnect();
})();
