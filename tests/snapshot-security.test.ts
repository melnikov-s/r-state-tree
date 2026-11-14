import {
	Model,
	applySnapshot,
	isObservable,
	observable,
	onSnapshot,
	signal,
	toSnapshot,
} from "../src/index";
import { clone, hydrateSnapshotValue } from "../src/utils";

const canary = "snapshotSecurityCanary";

afterEach(() => {
	// Keep a failing regression from contaminating other tests.
	Reflect.deleteProperty(Object.prototype, canary);
});

describe("snapshot dictionary key safety", () => {
	test.each(["plain", "observable", "null-prototype"])(
		"hydrates arbitrary nested keys into a %s dictionary without changing prototypes",
		(kind) => {
			class Document extends Model {
				data: Record<string, unknown> =
					kind === "observable"
						? observable({})
						: kind === "null-prototype"
							? Object.create(null)
							: {};
			}

			const document = Document.create();
			const data = document.data;
			const prototype = Object.getPrototypeOf(data);
			const snapshot = JSON.parse(
				`{"data":{"__proto__":{"${canary}":true},"constructor":{"prototype":{"${canary}":true}},"toString":{"value":1},"hasOwnProperty":2}}`
			);
			const snapshots: unknown[] = [];
			const stop = onSnapshot(document, (next) => snapshots.push(next));

			try {
				applySnapshot(document, snapshot);

				expect(
					Object.getOwnPropertyDescriptor(Object.prototype, canary)
				).toBeUndefined();
				expect(Reflect.get({}, canary)).toBeUndefined();
				expect(document.data).toBe(data);
				expect(Object.getPrototypeOf(data)).toBe(prototype);
				expect(Object.getOwnPropertyDescriptor(data, "__proto__")).toEqual({
					value: { [canary]: true },
					writable: true,
					enumerable: true,
					configurable: true,
				});
				expect(toSnapshot(document)).toEqual(snapshot);
				expect(snapshots).toEqual([snapshot]);

				// An existing own __proto__ key is an ordinary hydration target.
				const protoValue = data["__proto__"];
				const nextSnapshot = JSON.parse(JSON.stringify(snapshot));
				nextSnapshot.data["__proto__"][canary] = false;
				applySnapshot(document, nextSnapshot);
				expect(data["__proto__"]).toBe(protoValue);
				expect(toSnapshot(document)).toEqual(nextSnapshot);
				expect(snapshots).toHaveLength(2);
				expect(Object.getPrototypeOf(data)).toBe(prototype);

				applySnapshot(document, { data: {} });
				expect(Object.keys(data)).toEqual([]);
				expect(Object.getPrototypeOf(data)).toBe(prototype);
			} finally {
				stop();
			}
		}
	);

	test("never reads or invokes inherited accessors for new dictionary entries", () => {
		Object.defineProperty(Object.prototype, canary, {
			configurable: true,
			get() {
				throw new Error("inherited getter invoked");
			},
			set(_value: unknown) {
				throw new Error("inherited setter invoked");
			},
		});
		const target = {};
		const snapshot = JSON.parse(`{"${canary}":{"value":1}}`);

		expect(hydrateSnapshotValue(target, snapshot)).toBe(target);
		expect(Object.getOwnPropertyDescriptor(target, canary)?.value).toEqual({
			value: 1,
		});
		expect(clone(snapshot)).toEqual(snapshot);
	});

	test.each([false, true])(
		"clones arbitrary keys as own data properties (null prototype: %s)",
		(nullPrototype) => {
			const source = JSON.parse(
				`{"nested":{"__proto__":{"${canary}":true},"constructor":{"prototype":{"value":1}},"toString":2}}`
			);
			if (nullPrototype) Object.setPrototypeOf(source.nested, null);

			const copied = clone(source);

			expect(copied).toEqual(JSON.parse(JSON.stringify(source)));
			expect(Object.getPrototypeOf(copied.nested)).toBe(Object.prototype);
			expect(
				Object.prototype.hasOwnProperty.call(copied.nested, "__proto__")
			).toBe(true);
			expect(copied.nested["__proto__"]).not.toBe(source.nested["__proto__"]);
			expect(Reflect.get({}, canary)).toBeUndefined();
		}
	);

	test("array growth safely clones own __proto__ keys while preserving runtime shapes", () => {
		const exemplar: Record<string, unknown> = JSON.parse(
			'{"__proto__":{"value":1}}'
		);
		exemplar.date = new Date("2024-01-01T00:00:00.000Z");
		exemplar.count = signal(0);

		class Document extends Model {
			items = observable([observable(exemplar)]);
		}

		const document = Document.create();
		const item = {
			["__proto__"]: { value: 2 },
			date: "2025-01-01T00:00:00.000Z",
			count: 3,
		};
		applySnapshot(document, { items: [item, item] });

		for (const entry of document.items) {
			expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
			expect(Object.prototype.hasOwnProperty.call(entry, "__proto__")).toBe(
				true
			);
			expect(isObservable(entry)).toBe(true);
			expect(entry.date).toBeInstanceOf(Date);
			expect(entry.date).toEqual(new Date(item.date));
			expect(entry.count).toBeInstanceOf(signal(0).constructor);
			expect((entry.count as ReturnType<typeof signal>).value).toBe(3);
		}
		expect(document.items[1]["__proto__"]).not.toBe(
			document.items[0]["__proto__"]
		);
		expect(toSnapshot(document)).toStrictEqual({ items: [item, item] });
	});
});
