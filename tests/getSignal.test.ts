import { expect, expectTypeOf, test } from "vitest";
import {
	child,
	computed,
	effect,
	getSignal,
	id,
	Model,
	modelRef,
	observable,
	Observable,
	type ReadonlySignal,
	type Signal,
} from "../src/index.js";

test("field signals keep each key's type and write through the observable", () => {
	const state = observable({ count: 1, title: "one", 0: "zero" });
	const count = getSignal(state, "count");
	const title = getSignal(state, "title");
	const zero = getSignal(state, 0);

	expectTypeOf(count).toEqualTypeOf<Signal<number>>();
	expectTypeOf(title).toEqualTypeOf<Signal<string>>();
	expectTypeOf(zero).toEqualTypeOf<Signal<string>>();
	const checkWrites = () => {
		// @ts-expect-error the title's string type does not leak into count
		count.value = "two";
		// @ts-expect-error the count's number type does not leak into title
		title.value = 2;
	};
	void checkWrites;

	const values: [number, string, string][] = [];
	const stop = effect(() => {
		values.push([count.value, title.value, zero.value]);
	});
	try {
		count.value = 2;
		state.title = "two";
		zero.value = "updated";
		expect(state.count).toBe(2);
		expect(state[0]).toBe("updated");
		expect(getSignal(state, "count")).toBe(count);
		expect(values).toEqual([
			[1, "one", "zero"],
			[2, "one", "zero"],
			[2, "two", "zero"],
			[2, "two", "updated"],
		]);
	} finally {
		stop();
	}
});

test("peek resolves Model references without subscribing or exposing their stored IDs", () => {
	class Person extends Model {
		@id id = "";
	}
	class Team extends Model {
		@child(Person) people: Person[] = [];
		@modelRef(Person) lead?: Person;
		@modelRef(Person) selected: Person[] = [];
	}
	const team = Team.create({
		people: [{ id: "a" }, { id: "b" }],
		lead: { id: "a" },
		selected: [{ id: "a" }],
	});
	const lead = getSignal(team, "lead");
	const selected = getSignal(team, "selected");
	let runs = 0;
	const stop = effect(() => {
		lead.peek();
		selected.peek();
		runs++;
	});
	try {
		expect(lead.peek()).toBe(team.people[0]);
		expect(selected.peek()).toBe(team.selected);
		team.lead = team.people[1];
		team.selected = [team.people[1]];
		expect(runs).toBe(1);
		expect(lead.peek()).toBe(lead.value);
		expect(selected.peek()).toBe(selected.value);
		expect(selected.peek()[0]).toBe(team.people[1]);
	} finally {
		stop();
		team[Symbol.dispose]();
	}
});

test("configured getter-only computeds return native readonly signals", () => {
	class Counter extends Observable {
		count = 1;
		static types = { label: computed };

		@computed get doubled() {
			return this.count * 2;
		}

		get label() {
			return String(this.count);
		}
	}
	const state = new Counter();
	const doubled = getSignal(state, "doubled");
	const label = getSignal(state, "label");
	expectTypeOf(doubled).toEqualTypeOf<ReadonlySignal<number>>();
	expectTypeOf(label).toEqualTypeOf<ReadonlySignal<string>>();
	expect(() => {
		// @ts-expect-error a computed signal is readonly
		doubled.value = 9;
	}).toThrow(TypeError);

	const values: [number, string][] = [];
	const stop = effect(() => {
		values.push([doubled.value, label.value]);
	});
	try {
		state.count = 3;
		expect(values).toEqual([
			[2, "1"],
			[6, "3"],
		]);
		expect(getSignal(state, "doubled")).toBe(doubled);
	} finally {
		stop();
	}
});

test("unsupported getters throw at lookup without evaluating the getter", () => {
	class Counter extends Observable {
		get ordinary(): number {
			throw new Error("getter was evaluated");
		}
	}
	const state = new Counter();

	expect(() => getSignal(state, "ordinary")).toThrow(
		/getSignal.*ordinary.*observable field.*getter-only computed/
	);
	expect(() => getSignal({ count: 0 }, "count")).toThrow(
		/getSignal.*observable object/
	);
});

test("array index signals read and write through the observable array", () => {
	const values = observable(["old"]);
	const first = getSignal(values, 0);
	const length = getSignal(values, "length");
	first.value = "new";
	expect(values[0]).toBe("new");
	values.push("another");
	expect(length.value).toBe(2);
});
