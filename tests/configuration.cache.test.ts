import { Model, id, toSnapshot, transient } from "../src";
import { getConfigurationForCtor } from "../src/configuration";

it("reads live metadata and static type sources once, base-first, on hits and misses", () => {
	const reads: string[] = [];
	let baseMetadata = { hidden: transient };
	const baseTypes = { name: id };
	const initialTypes = { name: transient };
	let derivedTypes: object = initialTypes;
	const derivedMetadata = { title: transient };
	class Base extends Model {
		name = "";
		hidden = "";
	}
	class Derived extends Base {
		title = "";
	}
	for (const [Type, label, types, metadata] of [
		[Base, "base", () => baseTypes, () => baseMetadata],
		[Derived, "derived", () => derivedTypes, () => derivedMetadata],
	] as const) {
		Object.defineProperties(Type, {
			types: {
				get() {
					reads.push(`${label} types`);
					return types();
				},
			},
			[Symbol.metadata]: {
				get() {
					reads.push(`${label} metadata`);
					return metadata();
				},
			},
		});
	}

	function readConfiguration() {
		reads.length = 0;
		const configuration = getConfigurationForCtor(Derived);
		expect(reads).toEqual([
			"base types",
			"base metadata",
			"derived types",
			"derived metadata",
		]);
		return configuration;
	}

	const original = readConfiguration();
	expect(readConfiguration()).toBe(original);
	expect(toSnapshot(Derived.create())).toEqual({});

	derivedTypes = {};
	baseMetadata = { ...baseMetadata };
	const changed = readConfiguration();
	expect(changed).not.toBe(original);
	expect(readConfiguration()).toBe(changed);
	expect(toSnapshot(Derived.create({ name: "new ID" }))).toEqual({
		name: "new ID",
	});
});

it("refreshes inherited configuration when the prototype chain changes", () => {
	class Base extends Model {
		static types = { first: transient };
	}
	class Other extends Model {
		static types = { second: transient };
	}
	class Derived extends Base {}

	expect(Object.keys(getConfigurationForCtor(Derived))).toEqual(["first"]);
	Object.setPrototypeOf(Derived.prototype, Other.prototype);
	expect(Object.keys(getConfigurationForCtor(Derived))).toEqual(["second"]);
	Object.setPrototypeOf(Derived.prototype, Model.prototype);
	expect(Object.keys(getConfigurationForCtor(Derived))).toEqual([]);
});

it("reuses the latest equivalent cache entry when a static getter reenters resolution", () => {
	const types = { title: transient };
	let enter = true;
	let captured: object | undefined;
	class Reentrant extends Model {}
	Object.defineProperty(Reentrant, "types", {
		get() {
			if (enter) {
				enter = false;
				captured = getConfigurationForCtor(Reentrant);
			}
			return types;
		},
	});

	expect(getConfigurationForCtor(Reentrant)).toBe(captured);
});
