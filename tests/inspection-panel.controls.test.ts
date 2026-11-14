// @vitest-environment jsdom
import { createInspector } from "../devtools/src/devtools";
import { Store, createStore, mount } from "../src/index";
import { INSPECTION_SIGNATURES } from "../devtools/src/inspection/signatures";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

// The extension uses explicit JSON Set/Call actions, not the retired embedded
// panel's blur-to-save forms, named-argument widgets or persistent draft cache.
test("opted-in extension edits and async calls use the shared engine with displayed signatures", async () => {
	const { root, page, body, row, click, input, button, status, requests } =
		await fixture(true);
	expect(page.getElementById("mode")!.textContent).toContain(
		"Controls explicitly enabled"
	);
	for (const field of ["password", "double", "lazy"])
		expect(row(field).querySelector("textarea")).toBeNull();
	input("JSON value for count").value = "not JSON";
	await click("Set count");
	expect(status.className).toBe("error");
	expect(root.count).toBe(1);
	expect(requests.some((request) => request.op === "set")).toBe(false);
	input("JSON value for count").value = "10";
	await click("Set count");
	expect(root.count).toBe(10);
	expect(row("count").querySelector("code")!.textContent).toBe("10");
	expect(body.querySelector('[data-method="addAsync"] code')!.textContent).toBe(
		"addAsync(n: number)"
	);
	input("JSON arguments for addAsync").value = "[3]";
	const pending = click("Call addAsync");
	expect(button("Call addAsync").disabled).toBe(true);
	await pending;
	expect(root.count).toBe(13);
	expect(status.textContent).toBe("Returned: 13");
	expect(input("JSON value for count").value).toBe("13");
	expect(requests).toContainEqual(
		expect.objectContaining({ op: "call", method: "addAsync", args: [3] })
	);
});

test("method failures with partial effects are safely reported without rollback or automatic retry", async () => {
	const { root, page, row, click, status, requests } = await fixture(true);
	await click("Call fail");
	expect(root.count).toBe(2);
	expect(status.className).toBe("error");
	expect(status.textContent).toContain("state may have changed");
	expect(page.body.textContent).not.toContain("never-show-this-exception");
	expect(requests.filter((request) => request.op === "call")).toHaveLength(1);
	await click("Reconnect / refresh");
	expect(row("count").querySelector("code")!.textContent).toBe("2");
	expect(root.count).toBe(2);
});

test("JSON edit drafts never mutate app state on blur or Escape; only Set commits", async () => {
	const { root, input, click, requests } = await fixture(true);
	const draft = input("JSON value for count");
	draft.value = "9";
	draft.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
	);
	draft.dispatchEvent(new FocusEvent("blur"));
	expect(root.count).toBe(1);
	expect(requests.some((request) => request.op === "set")).toBe(false);
	draft.value = "7";
	await click("Set count");
	expect(root.count).toBe(7);
	expect(input("JSON value for count").value).toBe("7");
});

test("refreshing or changing selection cannot submit an uncommitted method draft", async () => {
	const { root, input, click, requests, page } = await fixture(true);
	input("JSON arguments for add").value = "[42]";
	await click("Reconnect / refresh");
	await click("Inspect settings");
	expect(page.getElementById("selection")!.textContent).toContain("/ settings");
	await click("Up");
	expect(root.count).toBe(1);
	expect(requests.some((request) => request.op === "call")).toBe(false);
	input("JSON arguments for add").value = "[2]";
	await click("Call add");
	expect(root.count).toBe(3);
});

test("missing method metadata is labeled honestly while positional JSON arguments still work", async () => {
	class Plain extends Store {
		count = 1;
		add(n: number) {
			this.count += n;
			return this.count;
		}
	}
	const root = mount(createStore(Plain));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Plain", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { body, click, input, status } = await openPanel(inspector, "Plain");
	expect(body.querySelector('[data-method="add"] code')!.textContent).toBe(
		"add(signature unavailable)"
	);
	input("JSON arguments for add").value = "[5]";
	await click("Call add");
	expect(root.count).toBe(6);
	expect(status.textContent).toBe("Returned: 6");
});

test("props navigate to their own control path rather than writing a same-named Store field", async () => {
	class Feature extends Store<{ title: string }> {
		title = "Store title";
		count = 2;
		get double() {
			return this.count * 2;
		}
		rename(title: string) {
			this.props.title = title;
		}
	}
	const root = mount(createStore(Feature, { title: "Original" }));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Feature", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { row, body, input, click, requests } = await openPanel(
		inspector,
		"Feature"
	);
	expect(row("double").textContent).toContain("Not evaluated");
	expect(body.querySelector('[data-method="rename"]')).not.toBeNull();
	await click("Inspect props");
	input("JSON value for title").value = '"Edited prop"';
	await click("Set title");
	expect(root.props.title).toBe("Edited prop");
	expect(root.title).toBe("Store title");
	expect(requests).toContainEqual(
		expect.objectContaining({
			op: "set",
			path: ["props"],
			field: "title",
			value: "Edited prop",
		})
	);
	await click("Up");
	expect(row("title").querySelector("code")!.textContent).toBe('"Store title"');
});

test.each([false, true])(
	"props and their callable members retain receiver identity with controls=%s",
	async (controls) => {
		type Props = { title: string; save: (title: string) => string };
		let receiver: unknown;
		const save = function (this: Props, title: string) {
			receiver = this;
			this.title = title;
			return this.title;
		};
		Object.defineProperty(save, INSPECTION_SIGNATURES, {
			value: {
				name: "save",
				parameters: [{ name: "title", type: "string", kind: "string" }],
				returnType: "string",
			},
		});
		class Feature extends Store<Props> {
			save() {
				return "Store method";
			}
		}
		const root = mount(createStore(Feature, { title: "Original", save }));
		const inspector = createInspector({ controls });
		inspector.registerRoot("Feature", root);
		cleanups.push(
			() => root[Symbol.dispose](),
			() => inspector.dispose()
		);
		const { body, row, click, input, requests, status } = await openPanel(
			inspector,
			"Feature"
		);
		expect(body.querySelector('[data-method="save"]')).not.toBeNull();
		await click("Inspect props");
		expect(row("title").querySelector("code")!.textContent).toBe('"Original"');
		expect(
			body.querySelector('[data-method="save"] code')!.textContent
		).toContain("save(title: string)");
		if (controls) {
			input("JSON arguments for save").value = '["Updated through callback"]';
			await click("Call save");
			expect(status.textContent).toBe('Returned: "Updated through callback"');
			expect(root.props.title).toBe("Updated through callback");
			expect(receiver).toBe(root.props);
			expect(requests).toContainEqual(
				expect.objectContaining({
					op: "call",
					path: ["props"],
					method: "save",
					args: ["Updated through callback"],
				})
			);
		} else {
			expect(body.querySelector("textarea")).toBeNull();
			expect(root.props.title).toBe("Original");
			expect(receiver).toBeUndefined();
			expect(requests.some((request) => request.op === "call")).toBe(false);
		}
	}
);

test("a completed async call never overwrites the user's newer selection or retries its effects", async () => {
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	class Slow extends Store {
		count = 1;
		settings = { theme: "dark" };
		async increment() {
			await wait;
			return ++this.count;
		}
	}
	const root = mount(createStore(Slow));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Slow", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { body, page, row, click, requests, button, status } = await openPanel(
		inspector,
		"Slow"
	);
	const pending = click("Call increment");
	expect(button("Call increment").disabled).toBe(true);
	await click("Inspect settings");
	expect(row("theme").querySelector("code")!.textContent).toBe('"dark"');
	release();
	await pending;
	expect(root.count).toBe(2);
	expect(page.getElementById("selection")!.textContent).toBe(
		"Slow · Store / settings"
	);
	expect(body.textContent).not.toContain("Returned:");
	expect(status.textContent).not.toContain("Returned:");
	expect(requests.filter((request) => request.op === "call")).toHaveLength(1);
});
