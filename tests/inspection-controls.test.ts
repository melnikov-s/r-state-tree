import {
	createInspector,
	type InspectorOptions,
} from "../src/inspection/runtime";
import { validateRequest } from "../src/inspection/protocol";
import {
	Store,
	Model,
	child,
	createStore,
	mount,
	effect,
	observable,
} from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.reverse()) cleanup();
	cleanups.length = 0;
	vi.useRealTimers();
});
function fixture(options: InspectorOptions = { controls: true }) {
	class Leaf extends Store {
		value = 1;
		add(n: number) {
			this.value += n;
			return this.value;
		}
	}
	class Base extends Store {
		baseMethod() {
			return "inherited";
		}
	}
	class Root extends Base {
		static types = { lazy: child };
		count = 1;
		password = "private-value";
		settings = observable({ theme: "dark", token: "private-value" });
		data = { nested: { value: 1 } };
		list = observable([1, 2]);
		foreign = new Date();
		locked = Object.freeze({ value: 1 });
		get double() {
			return this.count * 2;
		}
		get current() {
			return this.count;
		}
		set current(n: number) {
			this.count = n;
		}
		get failingSetter() {
			return 0;
		}
		set failingSetter(n: number) {
			this.count = n;
			throw new Error("private-exception");
		}
		get lazy() {
			return createStore(Leaf);
		}
		get methodGetter() {
			throw new Error("getter must not run");
		}
		add(n: number) {
			this.count += n;
			return this.count;
		}
		arrow = (n: number) => {
			this.count += n;
			return this.count;
		};
		async addAsync(n: number) {
			await Promise.resolve();
			this.count += n;
			return this.count;
		}
		async failAsync() {
			this.count++;
			await Promise.resolve();
			throw new Error("private-exception");
		}
		fail() {
			this.count++;
			throw new Error("private-exception");
		}
		secretMethod() {
			throw new Error("must not run");
		}
		profile() {
			return {
				message: "visible",
				password: "private-value",
				nested: { value: 2 },
			};
		}
		noResult() {}
		makeCycle() {
			const result: any = {};
			result.self = result;
			return result;
		}
		mutateInput(input: { value: number }) {
			input.value++;
			return input.value;
		}
		hang() {
			return new Promise(() => {});
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector(options);
	const registration = inspector.registerRoot("Application", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const inspect = (path: string[] = []): any =>
		inspector.query({ op: "inspect", rootId: registration.rootId, path });
	const set = (field: string, value: any, path: string[] = []) =>
		inspector.query({
			op: "set",
			rootId: registration.rootId,
			path,
			field,
			value,
		});
	const call = (method: string, args: any[] = [], path: string[] = []) =>
		inspector.query({
			op: "call",
			rootId: registration.rootId,
			path,
			method,
			args,
		});
	return { root, inspector, ...registration, inspect, set, call };
}

test("writes and calls require explicit controls opt-in, before application code runs", async () => {
	const { root, inspect, set, call } = fixture({});
	expect(() => set("count", 5)).toThrow("disabled");
	await expect(call("add", [5])).rejects.toThrow("disabled");
	expect(root.count).toBe(1);
	expect(inspect().methods).toContainEqual({ name: "add" });
	expect(inspect()).not.toHaveProperty("controls");
	expect(inspect().fields.every((f: any) => f.writable === undefined)).toBe(
		true
	);
});

test("discovery lists application methods and writable fields, not framework methods or callable getters", () => {
	const { inspect } = fixture();
	const value = inspect();
	expect(value.controls).toBe(true);
	expect(value.methods.map((m: any) => m.name)).toEqual(
		expect.arrayContaining(["add", "arrow", "addAsync", "baseMethod"])
	);
	for (const name of [
		"secretMethod",
		"effect",
		"reaction",
		"constructor",
		"methodGetter",
	])
		expect(value.methods.map((m: any) => m.name)).not.toContain(name);
	const field = (name: string) =>
		value.fields.find((f: any) => f.name === name);
	expect(field("count").writable).toBe(true);
	expect(field("props").writable).toBe(false);
	expect(field("current").writable).toBe(true);
	expect(field("double").writable).toBe(false);
	expect(field("password").writable).toBeUndefined();
	expect(field("lazy").writable).toBeUndefined();
});

test("writes use the reactive proxy and existing setters; nested paths use the same selection rules", () => {
	const { root, set } = fixture();
	const counts: number[] = [];
	const stop = effect(() => {
		counts.push(root.count);
	});
	cleanups.push(stop);
	expect(set("count", 3)).toEqual({ ok: true });
	expect(set("current", 5)).toEqual({ ok: true });
	expect(set("theme", "light", ["settings"])).toEqual({ ok: true });
	expect(root.settings.theme).toBe("light");
	expect(counts).toEqual([1, 3, 5]);
	expect(set("value", 4, ["data", "nested"])).toEqual({ ok: true });
	expect(root.data.nested.value).toBe(4);
});

test("calls retain this binding, inherited application methods, arrow functions and async results", async () => {
	const { root, call } = fixture();
	expect(await call("add", [2])).toEqual({ ok: true, result: 3 });
	expect(await call("arrow", [2])).toEqual({ ok: true, result: 5 });
	expect(await call("addAsync", [2])).toEqual({ ok: true, result: 7 });
	expect(await call("baseMethod")).toEqual({ ok: true, result: "inherited" });
	expect(root.count).toBe(7);
});

test("method results are bounded, redacted, cycle-safe and do not serialize exceptions", async () => {
	const { call } = fixture();
	const result: any = await call("profile");
	expect(result.ok).toBe(true);
	expect(JSON.stringify(result)).toContain("visible");
	expect(JSON.stringify(result)).not.toContain("private-value");
	expect(
		result.result.fields.find((f: any) => f.name === "password").value.kind
	).toBe("redacted");
	const cycle: any = await call("makeCycle");
	expect(cycle.result.fields[0].value.kind).toBe("reference");
});

test("setter failures and sync/async method failures are safe errors, not rollback", async () => {
	const { root, call, set } = fixture();
	const setter = set("failingSetter", 10);
	expect(setter).toMatchObject({
		ok: false,
		error: expect.stringContaining("state may have changed"),
	});
	expect(root.count).toBe(10);
	for (const name of ["fail", "failAsync"]) {
		const result = await call(name);
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("state may have changed"),
		});
		expect(JSON.stringify(result)).not.toContain("private-exception");
	}
	expect(root.count).toBe(12);
});

test("controls cannot bypass redaction at fields, methods, or ancestors", async () => {
	const { root, set, call } = fixture({
		controls: true,
		redact: (path) => path[0] === "data" || path.at(-1) === "add",
	});
	expect(() => set("password", "changed")).toThrow("Redacted");
	expect(() => set("token", "changed", ["settings"])).toThrow("Redacted");
	expect(() => set("value", 2, ["data", "nested"])).toThrow("Redacted");
	await expect(call("add", [2])).rejects.toThrow("Redacted");
	await expect(call("secretMethod")).rejects.toThrow("Redacted");
	expect(root.count).toBe(1);
	expect(root.password).toBe("private-value");
});

test("controls cannot add fields, overwrite methods/children, write getter-only fields or invoke framework/native methods", async () => {
	const { root, set, call } = fixture();
	for (const field of ["missing", "double", "add", "lazy", "props"])
		expect(() => set(field, null)).toThrow("writable");
	for (const method of ["effect", "reaction", "toString", "methodGetter"])
		await expect(call(method)).rejects.toThrow("application method");
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(false);
	await expect(call("add", [1], ["lazy"])).rejects.toThrow(
		"Not yet initialized"
	);
});

test("controls can reach an explicitly initialized child and a Model", async () => {
	const { rootId, inspector, call } = fixture();
	inspector.query({ op: "initialize", rootId, field: "lazy" });
	expect(await call("add", [3], ["lazy"])).toEqual({ ok: true, result: 4 });
	class Item extends Model {
		count = 1;
		add(n: number) {
			this.count += n;
			return this.count;
		}
	}
	const model = Item.create();
	const registration = inspector.registerRoot("Item", model);
	cleanups.push(() => model[Symbol.dispose]());
	expect(
		inspector.query({
			op: "set",
			rootId: registration.rootId,
			field: "count",
			value: 5,
		})
	).toEqual({ ok: true });
	expect(
		await inspector.query({
			op: "call",
			rootId: registration.rootId,
			method: "add",
			args: [2],
		})
	).toEqual({ ok: true, result: 7 });
});

test("control input is copied instead of retaining caller-owned objects", async () => {
	const { root, set, call } = fixture();
	const data = { nested: { value: 5 } };
	set("data", data);
	root.data.nested.value = 10;
	expect(data.nested.value).toBe(5);
	const argument = { value: 1 };
	expect(await call("mutateInput", [argument])).toEqual({
		ok: true,
		result: 2,
	});
	expect(argument.value).toBe(1);
});

test("disposed, unregistered and unsupported targets cannot be controlled", async () => {
	const { root, set, call, unregister } = fixture();
	root[Symbol.dispose]();
	expect(() => set("count", 2)).toThrow("Disposed");
	await expect(call("add", [1])).rejects.toThrow("Disposed");
	unregister();
	expect(() => set("count", 2)).toThrow("Unknown root");
});

test("async calls time out without implying cancellation, and detach does not retain a result capability", async () => {
	vi.useFakeTimers();
	const { root, call, unregister } = fixture();
	const pending = call("hang");
	await vi.advanceTimersByTimeAsync(4000);
	expect(await pending).toMatchObject({
		ok: false,
		error: expect.stringContaining("may still finish"),
	});
	const detached = call("addAsync", [1]);
	unregister();
	expect(await detached).toMatchObject({
		ok: false,
		error: expect.stringContaining("detached"),
	});
	expect(root.count).toBe(2);
});

test.each(["__proto__", "prototype", "constructor"])(
	"prototype key %s is blocked in every control input position",
	async (key) => {
		const { rootId, set, call } = fixture();
		expect(() => set(key, 1)).toThrow();
		expect(() => call(key)).toThrow();
		expect(() =>
			validateRequest({
				op: "set",
				rootId,
				field: "count",
				value: JSON.parse(`{"nested":{"${key}":1}}`),
			})
		).toThrow();
		expect(() =>
			validateRequest({
				op: "call",
				rootId,
				method: "add",
				args: [JSON.parse(`{"${key}":1}`)],
			})
		).toThrow();
	}
);

test("JSON input validation rejects executable, cyclic, oversized and malformed inputs before getters execute", () => {
	const { rootId, set, root } = fixture();
	const getter = vi.fn(() => 1);
	const accessor = Object.defineProperty({}, "value", {
		enumerable: true,
		get: getter,
	});
	const cycle: any = {};
	cycle.self = cycle;
	const sparse: any[] = [];
	sparse.length = 1_000_000;
	for (const input of [
		undefined,
		NaN,
		Infinity,
		() => {},
		1n,
		new Date(),
		accessor,
		cycle,
		sparse,
		"界".repeat(30000),
		Array(1001).fill(0),
	])
		expect(() => set("count", input)).toThrow();
	expect(getter).not.toHaveBeenCalled();
	expect(root.count).toBe(1);
	for (const request of [
		{ op: "set", rootId, field: "count" },
		{ op: "call", rootId, method: "add", args: {} },
		{ op: "call", rootId, method: "add", args: Array(33).fill(1) },
		{ op: "set", rootId, field: "count", value: 1, eval: "anything" },
	])
		expect(() => validateRequest(request)).toThrow();
});

test("only existing array indices can be written; readonly and foreign objects stay protected", async () => {
	const { root, set, call } = fixture();
	expect(set("0", 5, ["list"])).toEqual({ ok: true });
	expect(root.list[0]).toBe(5);
	for (const name of ["length", "2", "push"])
		expect(() => set(name, 1, ["list"])).toThrow();
	expect(() => set("value", 2, ["locked"])).toThrow("writable");
	expect(() => set("anything", 1, ["foreign"])).toThrow("Unsupported");
	await expect(call("setTime", [0], ["foreign"])).rejects.toThrow(
		"Unsupported"
	);
	await expect(call("push", [3], ["list"])).rejects.toThrow(
		"application method"
	);
});

test("method discovery and returned values respect budgets; transient results do not advertise control capabilities", async () => {
	const { root, inspector, rootId, call } = fixture();
	for (let i = 0; i < 100; i++)
		Object.defineProperty(root, `method${i}`, {
			value() {
				return i;
			},
			configurable: true,
		});
	const tree: any = inspector.query({ op: "inspect", rootId, maxEntries: 5 });
	expect(tree.methods.length).toBeLessThanOrEqual(4);
	expect(tree.truncated).toBe(true);
	const result: any = await inspector.query({
		op: "call",
		rootId,
		method: "profile",
		maxEntries: 3,
	});
	expect(result.ok).toBe(true);
	expect(result.result.truncated).toBe(true);
	expect(result.result).not.toHaveProperty("controls");
	expect(result.result.fields.every((f: any) => f.writable === undefined)).toBe(
		true
	);
	expect(JSON.stringify(result)).not.toContain("private-value");
	expect(await call("noResult")).toEqual({
		ok: true,
		result: { kind: "unsupported", detail: "undefined" },
	});
});
