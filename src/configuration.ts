import type {
	ConfigurationType,
	ConfigurationTypes,
	ConfigurationValue,
} from "./types";
import { childType, idType, transientType, snapshotType } from "./types";
import { child, id, modelRef, transient, snapshot } from "./decorators";

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

function getCtorChain(ctor: Ctor): Ctor[] {
	const chain: Ctor[] = [];
	let node: Ctor | undefined = ctor;
	while (node) {
		chain.push(node);
		const parent = getParentConstructor(node);
		if (!parent || parent === Object || parent === Function) {
			break;
		}
		node = parent;
	}
	// Base first, derived last
	chain.reverse();
	return chain;
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

type CacheEntry = {
	refs: Array<{ ctor: Ctor; typesRef: unknown; metaRef: unknown }>;
	merged: Config;
};

const configurationCache: WeakMap<Ctor, CacheEntry> = new WeakMap();

function refsEqual(a: CacheEntry["refs"], b: CacheEntry["refs"]): boolean {
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

	const chain = getCtorChain(ctor);
	const refs = chain.map((c) => ({
		ctor: c,
		typesRef: getOwnStaticTypes(c as any),
		metaRef: getOwnMetadata(c as any),
	}));

	const cached = configurationCache.get(ctor);
	if (cached && refsEqual(cached.refs, refs)) {
		return cached.merged;
	}

	const merged: Config = {};
	for (let i = 0; i < refs.length; i++) {
		const { typesRef, metaRef } = refs[i];
		// Base-first merge, derived overrides.
		// Within the same ctor: metadata first, then static types.
		mergeInto(merged, metaRef);
		mergeInto(merged, typesRef);
	}

	configurationCache.set(ctor, { refs, merged });
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
