// @vitest-environment jsdom
import { createInspector } from "../src/devtools";
import { Store, computed, createStore, mount } from "../src/index";
import { INSPECTION_SIGNATURES } from "../src/inspection/signatures";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

test("opt-in panel edits inline and calls methods with named typed arguments through the shared engine", async () => {
	const { root, body, row, click } = fixture(true);
	// Let the browser's queued initial details toggle finish before submitting async controls.
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(body.textContent).toContain("Controls enabled");
	expect(row("password").querySelector("input,textarea,select")).toBeNull();
	expect(row("double").querySelector("input,textarea,select")).toBeNull();
	expect(row("lazy").querySelector("input,textarea,select")).toBeNull();
	expect(body.querySelector('[aria-label="Edit field count"]')).toBeNull();
	let form = row("count").querySelector("form")!;
	const input = form.querySelector("input")!;
	input.value = "not a number";
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	expect(form.textContent).toContain("finite number");
	expect(root.count).toBe(1);
	input.value = "10";
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	await vi.waitFor(() =>
		expect(row("count").querySelector("input")!.value).toBe("10")
	);
	expect(root.count).toBe(10);
	form = body.querySelector('[data-method="addAsync"] form')!;
	form.querySelector("input")!.value = "3";
	expect(form.textContent).toContain("number");
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	expect(form.querySelector("button")!.disabled).toBe(true);
	await vi.waitFor(() => expect(body.textContent).toContain("Returned: 13"));
	expect(root.count).toBe(13);
	expect(row("count").querySelector("input")!.value).toBe("13");
});

test("panel reports method failures safely and refreshes partial effects", async () => {
	const { root, body, row, click } = fixture(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method fail");
	body
		.querySelector('[data-method="fail"] form')!
		.dispatchEvent(new Event("submit", { cancelable: true }));
	await vi.waitFor(() =>
		expect(body.querySelector('[role="alert"]')!.textContent).toContain(
			"state may have changed"
		)
	);
	expect(root.count).toBe(2);
	expect(row("count").querySelector("input")!.value).toBe("2");
	expect(body.textContent).not.toContain("never-show-this-exception");
});

test("inline edits save on blur, cancel on Escape, and preserve focus after saving", async () => {
	const { root, row, body } = fixture(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	let input = row("count").querySelector("input")!;
	input.focus();
	input.value = "9";
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
	);
	expect(root.count).toBe(1);
	input.focus();
	input.value = "7";
	input.dispatchEvent(new FocusEvent("blur"));
	await vi.waitFor(() => expect(root.count).toBe(7));
	await vi.waitFor(() => expect(body.textContent).toContain("Saved count"));
	input = row("count").querySelector("input")!;
	expect(input.value).toBe("7");
});

test("typed method drafts survive refresh and tree navigation", async () => {
	const { shadow, body, click } = fixture(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method add");
	body.querySelector<HTMLInputElement>(
		'[data-method="add"] [data-parameter="n"]'
	)!.value = "42";
	click("Refresh");
	expect(
		body.querySelector<HTMLInputElement>(
			'[data-method="add"] [data-parameter="n"]'
		)!.value
	).toBe("42");
	expect(
		body.querySelector<HTMLDetailsElement>('[data-method="add"]')!.open
	).toBe(true);
	click("Select settings");
	click("Go to Counter");
	expect(
		body.querySelector<HTMLInputElement>(
			'[data-method="add"] [data-parameter="n"]'
		)!.value
	).toBe("42");
	expect(
		shadow.querySelector("textarea[aria-label='JSON arguments for add']")
	).toBeNull();
});

test("missing method metadata gets individual arguments, without guessed names or types", async () => {
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
	const { body, click } = openPanel(inspector, "Plain");
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method add");
	click("+ Argument");
	body.querySelector<HTMLTextAreaElement>(
		'[data-parameter="argument 1"]'
	)!.value = "5";
	click("Run method add");
	await vi.waitFor(() => expect(root.count).toBe(6));
	await vi.waitFor(() => expect(body.textContent).toContain("Returned: 6"));
});

test("overview groups show props, computed fields and methods together, and inline props target their own path", async () => {
	class Feature extends Store<{ title: string }> {
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
	const { shadow, body } = openPanel(inspector, "Feature");
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(
		[...body.querySelectorAll(".overview-group > summary")].map(
			(node) => node.textContent
		)
	).toEqual(
		expect.arrayContaining([
			"Props1",
			"Available Context0",
			"Computed1",
			"Methods1",
		])
	);
	expect(
		body.querySelector('[data-group="Props"] [data-field="props"]')
	).toBeNull();
	const input = body.querySelector<HTMLInputElement>(
		'[aria-label="Value for prop title"]'
	)!;
	input.value = "Edited prop";
	input.form!.dispatchEvent(new Event("submit", { cancelable: true }));
	await vi.waitFor(() => expect(root.props.title).toBe("Edited prop"));
	expect(
		shadow.querySelector('[aria-label="Object overview"]')!.textContent
	).toContain("1 Props");
	expect(
		[...body.querySelectorAll(".overview-member-names")].map(
			(node) => node.textContent
		)
	).toEqual(["title", "None discovered", "double", "rename"]);
	expect(root).not.toHaveProperty("title");
});

test.each([false, true])(
	"props list values and callable props directly with controls=%s",
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
		const { body, click } = openPanel(inspector, "Feature");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const props = body.querySelector('[data-group="Props"]')!;
		expect(props.querySelector('[data-field="props"]')).toBeNull();
		expect(props.querySelector('[aria-label="Inspect props"]')).toBeNull();
		expect(props.textContent).not.toContain("Observable");
		expect(props.querySelector('[data-field="title"]')).not.toBeNull();
		expect(props.querySelector('[data-prop-method="save"]')).not.toBeNull();
		expect(props.querySelector("summary")!.textContent).toBe("Props2");
		expect(body.querySelector('[aria-label="2 Props"]')!.textContent).toContain(
			"title · save"
		);
		click("Configure callback prop save");
		const callback = props.querySelector('[data-prop-method="save"]')!;
		const input = callback.querySelector<HTMLInputElement>(
			'[data-parameter="title"]'
		)!;
		expect(input.disabled).toBe(!controls);
		expect(
			callback.querySelector<HTMLButtonElement>(
				'[aria-label="Run callback prop save"]'
			)!.disabled
		).toBe(!controls);
		input.value = "Updated through callback";
		callback
			.querySelector("form")!
			.dispatchEvent(new Event("submit", { cancelable: true }));
		if (controls) {
			await vi.waitFor(() =>
				expect(body.textContent).toContain(
					'Returned: "Updated through callback"'
				)
			);
			expect(root.props.title).toBe("Updated through callback");
			expect(receiver).toBe(root.props);
			expect(
				body.querySelector<HTMLInputElement>(
					'[aria-label="Value for prop title"]'
				)!.value
			).toBe("Updated through callback");
		} else {
			expect(root.props.title).toBe("Original");
			expect(receiver).toBeUndefined();
		}
		expect(
			body.querySelector(
				'[data-group="Methods"] [aria-label="Configure method save"]'
			)
		).not.toBeNull();
	}
);

test("finishing a pending call refreshes but never changes the user's new selection", async () => {
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
	const { body, shadow, click } = openPanel(inspector, "Slow");
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method increment");
	click("Run method increment");
	expect(body.textContent).toContain("Running…");
	click("Select settings");
	expect(
		body.querySelector<HTMLInputElement>('[aria-label="Value for theme"]')!
			.disabled
	).toBe(true);
	release();
	await vi.waitFor(() =>
		expect(
			body.querySelector<HTMLInputElement>('[aria-label="Value for theme"]')!
				.disabled
		).toBe(false)
	);
	expect(root.count).toBe(2);
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"settings"
	);
	expect(body.textContent).not.toContain("Returned:");
});
