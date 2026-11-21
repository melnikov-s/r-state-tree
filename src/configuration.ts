import type {
	ConfigurationType,
	ConfigurationTypes,
	ConfigurationValue,
} from "./types.js";
import { childType, idType, transientType, snapshotType } from "./types.js";
import { child, id, modelRef, transient, snapshot } from "./decorators.js";

type Ctor = Function;
type Config = Record<PropertyKey, ConfigurationType>;

type ConfigLike = {
	type: ConfigurationTypes;
	childType?: Function;
};

function hasConfigLike(value: unknown): value is ConfigLike {
	if (!value) return false;
	const t = typeof value;
	if (t !== "object" && t !== "function") return false;
	return "type" in (value as any);
}

function normalizeEntry(entry: unknown): ConfigurationType | undefined {
	if (!entry) return undefined;
	if (hasConfigLike(entry)) return entry as ConfigurationType;
	if (typeof entry === "function") {
		// Allow using the exported decorators directly in `static types`.
		// These are plain functions without a `type` property.
		if (entry === id) return idType;
		if (entry === transient) return transientType;
		if (entry === snapshot) return snapshotType;
		if (entry === child) return childType;
		if (entry === modelRef) {
			throw new Error(
				"r-state-tree: modelRef requires a model constructor, for example `modelRef(User)`"
			);
		}
		// `computed` is handled by tagging the function with `.type` in `observables/preact`.
		return undefined;
	}
	return undefined;
}

export function getConfigType(
	entry: ConfigurationType | undefined
): ConfigurationTypes | undefined {
	const normalized = normalizeEntry(entry);
	return normalized && hasConfigLike(normalized)
		? (normalized.type as ConfigurationTypes)
		: undefined;
}

export function getConfigChildType(
	entry: ConfigurationType | undefined
): Function | undefined {
	const normalized = normalizeEntry(entry);
	if (!normalized || !hasConfigLike(normalized)) return undefined;
	if (typeof normalized === "function") {
		return (normalized as any).childType as Function | undefined;
	}
	return (normalized as ConfigurationValue).childType;
}

function getParentConstructor(Ctor: Ctor | undefined): Ctor | undefined {
	return Ctor?.prototype
		? (Object.getPrototypeOf(Ctor.prototype)?.constructor as Ctor | undefined)
		: undefined;
}

// The chain is kept derived-first so it can be checked as we walk it.
function getCtorChain(
	ctor: Ctor,
	previous: readonly Ctor[] = []
): readonly Ctor[] {
	let changed: Ctor[] | undefined;
	let length = 0;
	let node = ctor;
	while (true) {
		if (!changed && previous[length] !== node) {
			changed = previous.slice(0, length);
		}
		changed?.push(node);
		length++;
		const parent = getParentConstructor(node);
		if (!parent || parent === Object || parent === Function) break;
		node = parent;
	}
	return (
		changed ??
		(previous.length === length ? previous : previous.slice(0, length))
	);
}

function getMetadataSymbol(): symbol | undefined {
	const sym = (Symbol as any).metadata;
	return typeof sym === "symbol" ? (sym as symbol) : undefined;
}

function getOwnMetadata(ctor: any): unknown {
	const metadataSymbol = getMetadataSymbol();
	if (!metadataSymbol) return undefined;
	return Object.prototype.hasOwnProperty.call(ctor, metadataSymbol)
		? ctor[metadataSymbol]
		: undefined;
}

function getOwnStaticTypes(ctor: any): unknown {
	return Object.prototype.hasOwnProperty.call(ctor, "types")
		? ctor.types
		: undefined;
}

function mergeInto(target: Config, source: unknown): void {
	if (!source || typeof source !== "object") return;
	for (const key of Reflect.ownKeys(source)) {
		const value = (source as any)[key];
		const normalized = normalizeEntry(value);
		if (normalized) {
			(target as any)[key] = normalized;
		}
	}
}

type ConfigurationRefs = { ctor: Ctor; typesRef: unknown; metaRef: unknown };

type CacheEntry = {
	chain: readonly Ctor[];
	refs: readonly ConfigurationRefs[];
	merged: Config;
};

const configurationCache = new WeakMap<Ctor, { entry?: CacheEntry }>();

function collectRefs(
	chain: readonly Ctor[],
	previous?: readonly ConfigurationRefs[]
): readonly ConfigurationRefs[] {
	let changed: ConfigurationRefs[] | undefined;
	// Evaluate config getters once, base-first, even when the cache misses.
	for (let i = chain.length - 1; i >= 0; i--) {
		const ctor = chain[i];
		const typesRef = getOwnStaticTypes(ctor);
		const metaRef = getOwnMetadata(ctor);
		const index = chain.length - 1 - i;
		const prior = previous?.[index];
		if (
			!changed &&
			prior &&
			prior.typesRef === typesRef &&
			prior.metaRef === metaRef
		)
			continue;
		(changed ??= previous?.slice(0, index) ?? []).push({
			ctor,
			typesRef,
			metaRef,
		});
	}
	return changed ?? previous!;
}

function refsEqual(
	a: readonly ConfigurationRefs[],
	b: readonly ConfigurationRefs[]
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].ctor !== b[i].ctor) return false;
		if (a[i].typesRef !== b[i].typesRef) return false;
		if (a[i].metaRef !== b[i].metaRef) return false;
	}
	return true;
}

/**
 * Returns the effective configuration for a class constructor.
 *
 * Sources (per class):
 * - Decorator metadata: `Ctor[Symbol.metadata]`
 * - Static map: `Ctor.types`
 *
 * Precedence (within the same class): static `types` overrides decorator metadata.
 * Precedence (inheritance): derived overrides base by key.
 */
export function getConfigurationForCtor(ctor: Ctor | undefined): Config {
	if (!ctor) return {};

	let slot = configurationCache.get(ctor);
	if (!slot) {
		slot = {};
		configurationCache.set(ctor, slot);
	}
	const cached = slot.entry;
	const chain = getCtorChain(ctor, cached?.chain);
	const refs = collectRefs(
		chain,
		cached?.chain === chain ? cached.refs : undefined
	);
	// A static getter can reenter configuration resolution for this constructor.
	// Compare against the latest entry, using the references already collected.
	const latest = slot.entry;
	if (latest && refsEqual(latest.refs, refs)) return latest.merged;

	const merged: Config = {};
	for (let i = 0; i < refs.length; i++) {
		const { typesRef, metaRef } = refs[i];
		// Base-first merge, derived overrides.
		// Within the same ctor: metadata first, then static types.
		mergeInto(merged, metaRef);
		mergeInto(merged, typesRef);
	}

	slot.entry = { chain, refs, merged };
	return merged;
}

export function getConfigurationValue(
	ctor: Ctor | undefined,
	key: PropertyKey
): ConfigurationType | undefined {
	return (getConfigurationForCtor(ctor) as any)[key];
}

export function getConfigurationType(
	ctor: Ctor | undefined,
	key: PropertyKey
): ConfigurationTypes | undefined {
	return getConfigType(getConfigurationValue(ctor, key));
}

export function getConfigurationChildType(
	ctor: Ctor | undefined,
	key: PropertyKey
): Function | undefined {
	return getConfigChildType(getConfigurationValue(ctor, key));
}
