import type { OperationTimeline } from "./operations";
import {
	createActivityRecorder,
	type ActivityLocation,
	type ActivityOptions,
} from "./activity";
import Store from "../store/Store";
import Model from "../model/Model";
import { StoreAdministration } from "../store/StoreAdministration";
import { ModelAdministration } from "../model/ModelAdministration";
import {
	getAdministration,
	getSource,
	Observable,
} from "../observables/internal/lookup";
import { PreactObjectAdministration } from "../observables/preact";
import { untracked } from "../observables";
import { lookupInspectionMethod, type InspectionMethod } from "./signatures";
import {
	contextData,
	contextDescriptor,
	contextMetadata,
	declaredContexts,
	knownContextProvider,
	MAX_INSPECTION_CONTEXTS,
	type InspectionContext,
} from "./contexts";
import {
	isBlockedKey,
	validateRequest,
	type InspectionRequest,
} from "./protocol";

export type InspectionValue =
	| null
	| boolean
	| number
	| string
	| InspectionValue[]
	| { [key: string]: InspectionValue };
export type InspectorOptions = {
	/** Development-only recording of proxy method calls and mutations. Off by default. */
	activity?: boolean | ActivityOptions;
	/** Optional intent labels alongside automatic activity. Redaction uses $operations/id/name|error paths. */
	operations?: OperationTimeline;
	/** Applied BEFORE reading a field, including computed and child fields. Return true to hide it. */
	redact?: (path: readonly string[]) => boolean;
	/** Allow field writes and application method calls. Trusted local development only. */
	controls?: boolean;
};
type RuntimeAdministration = StoreAdministration | ModelAdministration;
type Field = { key: PropertyKey; type?: string; getter: boolean };
type InspectionBudget = {
	remaining: number;
	evaluateComputeds?: boolean;
	paths?: Map<object, string[]>;
	methods?: {
		methods: InspectionValue[];
		method: { [key: string]: InspectionValue };
		signature?: InspectionMethod;
	}[];
	contexts?: {
		value: object;
		path: string[];
		result: { [key: string]: InspectionValue };
	}[];
	signatures?: {
		method: { [key: string]: InspectionValue };
		signature: InspectionMethod;
	}[];
};
const marker = (kind: string, detail?: string): InspectionValue => ({
	kind,
	...(detail ? { detail } : {}),
});
const secret = /password|secret|token|authorization|cookie|credential/i;
function boundedOperationRecords<T>(records: T[]) {
	const selected: T[] = [];
	const encoder = new TextEncoder();
	let bytes = 0;
	for (const record of records) {
		bytes += encoder.encode(JSON.stringify(record)).byteLength;
		if (selected.length >= 500 || bytes > 512 * 1024) break;
		selected.push(record);
	}
	return {
		records: selected,
		...(selected.length < records.length ? { truncated: true } : {}),
	};
}
function administration(value: object): RuntimeAdministration | undefined {
	const adm = getAdministration(value);
	return adm instanceof StoreAdministration ||
		adm instanceof ModelAdministration
		? adm
		: undefined;
}
function objectAdministration(
	value: object
): PreactObjectAdministration<object> | undefined {
	const adm = getAdministration(value);
	return adm instanceof PreactObjectAdministration ? adm : undefined;
}
/** Own properties plus application prototypes, stopping before framework/native methods. */
function descriptors(value: object): Map<PropertyKey, PropertyDescriptor> {
	const source = getSource(value);
	const result = new Map<PropertyKey, PropertyDescriptor>();
	let current = source;
	for (let depth = 0; current && depth < 17; depth++) {
		for (const key of Reflect.ownKeys(current)) {
			if (!result.has(key))
				result.set(key, Object.getOwnPropertyDescriptor(current, key)!);
		}
		if (!objectAdministration(value)) break;
		current = Object.getPrototypeOf(current);
		if (
			!current ||
			[
				Store.prototype,
				Model.prototype,
				Observable.prototype,
				Object.prototype,
			].includes(current)
		)
			break;
	}
	return result;
}
/** Concrete application class label, without reading constructor/name accessors. */
function inspectionClassName(source: object): string | undefined {
	const prototype = Object.getPrototypeOf(source);
	if (!prototype || prototype === Object.prototype) return undefined;
	const constructor = Object.getOwnPropertyDescriptor(
		prototype,
		"constructor"
	)?.value;
	if (typeof constructor !== "function") return undefined;
	const name = Object.getOwnPropertyDescriptor(constructor, "name")?.value;
	return typeof name === "string" && name.length > 0
		? name.slice(0, 128)
		: undefined;
}
function fields(value: object): Field[] {
	const adm = administration(value);
	const source = getSource(value);
	const metadata = new Map<PropertyKey, string | undefined>(
		adm?.getInspectionMetadata().fields.map((f) => [f.key, f.type])
	);
	const keys = new Map<PropertyKey, boolean>();
	for (const [key, descriptor] of descriptors(value)) {
		if (Object.prototype.hasOwnProperty.call(source, key) || descriptor.get)
			keys.set(key, !!descriptor.get);
	}
	for (const key of metadata.keys()) if (!keys.has(key)) keys.set(key, false);
	return [...keys]
		.filter(([key]) => key !== "constructor")
		.map(([key, getter]) => ({ key, getter, type: metadata.get(key) }));
}

/** An explicit, page-local registry. dispose/unregister release roots; no global production hooks. */
export function createInspector(options: InspectorOptions = {}) {
	const roots = new Map<string, { name: string; value: object }>();
	const ids = new WeakMap<object, string>();
	const contextIds = new WeakMap<object, string>();
	const contextId = (context: object) => {
		let result = contextIds.get(context);
		if (!result) {
			result = `${prefix}-context-${++sequence}`;
			contextIds.set(context, result);
		}
		return result;
	};
	const prefix = Math.random().toString(36).slice(2);
	let sequence = 0;
	let disposed = false;
	const id = (value: object) => {
		const source = getSource(value);
		let result = ids.get(source);
		if (!result) {
			result = `${prefix}-${++sequence}`;
			ids.set(source, result);
		}
		return result;
	};
	const hidden = (path: string[]) =>
		secret.test(path[path.length - 1] ?? "") || !!options.redact?.(path);
	// Index only retained data: never initialize children, evaluate computeds or read Context.
	let activityPaths = new WeakMap<object, ActivityLocation>();
	let missingActivityPaths = new WeakSet<object>();
	let activityDiscoveryTruncated = false;
	const activityVisible = (at: ActivityLocation) =>
		roots.has(at.rootId) &&
		!hidden(["$operations"]) &&
		at.path.every((_, i) => !hidden(at.path.slice(0, i + 1)));
	const activityChild = (value: object, key: string): unknown => {
		const adm = administration(value);
		if (
			adm instanceof StoreAdministration &&
			adm
				.getInspectionMetadata()
				.fields.some((f) => f.key === key && f.type === "child")
		)
			return adm.peekInspectionChild(key).value;
		return Object.getOwnPropertyDescriptor(getSource(value), key)?.value;
	};
	const locateActivity = (target: object): ActivityLocation | undefined => {
		const cached = activityPaths.get(target);
		if (cached && activityVisible(cached)) {
			let value: unknown = roots.get(cached.rootId)?.value;
			for (const key of cached.path) {
				if (!value || typeof value !== "object") {
					value = undefined;
					break;
				}
				value = activityChild(value, key);
			}
			if (getSource(value) === target) return cached;
		}
		if (missingActivityPaths.has(target)) return undefined;
		activityPaths = new WeakMap();
		const queue = [...roots].map(([rootId, root]) => ({
			value: root.value,
			rootId,
			rootName: root.name,
			path: [] as string[],
		}));
		let remaining = 10000;
		for (let i = 0; i < queue.length && remaining-- > 0; i++) {
			const { value, ...at } = queue[i];
			if (!value || typeof value !== "object" || !activityVisible(at)) continue;
			const source = getSource(value);
			if (activityPaths.has(source)) continue;
			activityPaths.set(source, at);
			if (at.path.length >= 16) {
				activityDiscoveryTruncated = true;
				continue;
			}
			if (
				!getAdministration(source) &&
				!Array.isArray(source) &&
				![Object.prototype, null].includes(Object.getPrototypeOf(source))
			)
				continue;
			const candidates = fields(value);
			if (candidates.length > 1000) activityDiscoveryTruncated = true;
			for (const field of candidates.slice(0, 1000)) {
				if (typeof field.key !== "string") continue;
				const path = [...at.path, field.key];
				if (!activityVisible({ ...at, path })) continue;
				const child = activityChild(value, field.key);
				if (child && typeof child === "object" && queue.length < 10000)
					queue.push({ value: child, ...at, path });
			}
		}
		if (remaining <= 0 || queue.length >= 10000)
			activityDiscoveryTruncated = true;
		const found = activityPaths.get(target);
		if (!found) missingActivityPaths.add(target);
		return found;
	};
	const activityMethodNames = new WeakMap<object, WeakMap<Function, string>>();
	const activityMethodName = (target: object, fn: Function) => {
		const source = getSource(target);
		let methods = activityMethodNames.get(source);
		if (!methods) {
			methods = new WeakMap();
			activityMethodNames.set(source, methods);
		}
		const cached = methods.get(fn);
		if (cached) {
			let current = source;
			for (let depth = 0; current && depth < 17; depth++) {
				const descriptor = Object.getOwnPropertyDescriptor(current, cached);
				if (descriptor) {
					if (descriptor.value === fn) return cached;
					break;
				}
				current = Object.getPrototypeOf(current);
			}
		}
		const name = [...descriptors(target)].find(
			([key, d]) => typeof key === "string" && d.value === fn
		)?.[0] as string | undefined;
		if (name !== undefined) methods.set(fn, name);
		return name;
	};
	const activity = options.activity
		? createActivityRecorder(
				typeof options.activity === "object" ? options.activity : {},
				(target, mutation) => {
					const at = locateActivity(target);
					// A known container may have just acquired a new descendant.
					if (at && mutation) missingActivityPaths = new WeakSet();
					return at;
				},
				activityMethodName,
				activityVisible
			)
		: undefined;
	const read = (value: object, field: Field, path: string[]): unknown => {
		if (hidden(path)) throw new Error("Redacted selection");
		const adm = administration(value);
		if (adm instanceof StoreAdministration && field.type === "child") {
			const child = adm.peekInspectionChild(field.key);
			if (!child.initialized) throw new Error("Not yet initialized");
			return child.value;
		}
		const objectAdm = objectAdministration(value);
		if (field.getter && !objectAdm) throw new Error("Unsupported accessor");
		return Reflect.get(objectAdm?.proxy ?? value, field.key);
	};
	function select(
		rootId: string,
		path: string[],
		paths?: Map<object, string[]>,
		evaluateComputeds = true
	) {
		const root = roots.get(rootId);
		if (!root) throw new Error("Unknown root; list roots again");
		let value: unknown = root.value;
		paths?.set(getSource(root.value), []);
		for (let i = 0; i < path.length; i++) {
			if (!value || typeof value !== "object")
				throw new Error("Path is not inspectable");
			const source = getSource(value);
			if (
				!objectAdministration(value) &&
				!Array.isArray(source) &&
				Object.getPrototypeOf(source) !== Object.prototype &&
				Object.getPrototypeOf(source) !== null
			)
				throw new Error("Unsupported object internals");
			if (administration(value)?.getInspectionMetadata().status === "disposed")
				throw new Error("Disposed runtime");
			const field = fields(value).find((f) => f.key === path[i]);
			if (!field) throw new Error("Unknown field");
			if (
				!evaluateComputeds &&
				field.getter &&
				!(
					administration(value) instanceof StoreAdministration &&
					field.type === "child"
				)
			)
				throw new Error("Computed selection not evaluated");
			value = read(value, field, path.slice(0, i + 1));
			if (value && typeof value === "object")
				paths?.set(getSource(value), path.slice(0, i + 1));
		}
		return value;
	}
	function inspect(
		value: unknown,
		path: string[],
		depth: number,
		budget: InspectionBudget,
		seen: Set<object>,
		exposeControls = options.controls === true
	): InspectionValue {
		if (budget.remaining-- <= 0) return marker("truncated", "entry budget");
		if (value === null || typeof value === "boolean") return value;
		if (typeof value === "number")
			return Number.isFinite(value) ? value : marker("number", String(value));
		if (typeof value === "string")
			return value.length > 500
				? {
						kind: "truncated",
						detail: "string",
						length: value.length,
						head: value.slice(0, 500),
					}
				: value;
		if (typeof value !== "object") return marker("unsupported", typeof value);
		const source = getSource(value);
		if (!budget.paths?.has(source)) budget.paths?.set(source, path);
		const nodeId = id(value);
		if (seen.has(source)) return { kind: "reference", id: nodeId };
		seen.add(source);
		const adm = administration(value);
		const kind =
			adm instanceof StoreAdministration
				? "Store"
				: adm instanceof ModelAdministration
					? "Model"
					: objectAdministration(value)
						? "Observable"
						: Array.isArray(source)
							? "array"
							: "object";
		const result: { [key: string]: InspectionValue } = { id: nodeId, kind };
		if (adm || objectAdministration(value)) {
			const className = inspectionClassName(source);
			if (className) result.className = className;
		}
		if (adm) {
			const meta = adm.getInspectionMetadata();
			result.status = meta.status;
			result.parentId = meta.parent ? id(meta.parent) : null;
			if (meta.status === "disposed") return result;
			if (adm instanceof StoreAdministration) {
				budget.contexts?.push({ value, path, result });
				try {
					const keyHidden = hidden(path.concat("key"));
					if (!keyHidden && budget.evaluateComputeds === false)
						budget.remaining--;
					result.key = keyHidden
						? marker("redacted")
						: budget.evaluateComputeds === false
							? marker("deferred", "Computed value not evaluated")
							: inspect(
									(adm.proxy as Store).key,
									path.concat("key"),
									0,
									budget,
									seen,
									exposeControls
								);
				} catch {
					result.key = marker(
						"error",
						"Key evaluation failed (details withheld)"
					);
				}
			}
		} else if (source instanceof Date) {
			try {
				return {
					...result,
					kind: "date",
					value: Date.prototype.toISOString.call(source),
				};
			} catch {
				return marker("error", "Invalid date");
			}
		} else if (source instanceof Map || source instanceof Set) {
			// Never expose entries outside the path-based redaction policy.
			return {
				...result,
				kind: "unsupported",
				detail: source instanceof Map ? "Map" : "Set",
			};
		} else if (
			!objectAdministration(value) &&
			!Array.isArray(source) &&
			Object.getPrototypeOf(source) !== Object.prototype &&
			Object.getPrototypeOf(source) !== null
		) {
			return {
				...result,
				kind: "unsupported",
				detail: "Non-plain object (including Promise); internals not inspected",
			};
		}
		if (exposeControls) result.controls = true;
		if (depth <= 0) return { ...result, truncated: true };
		const controlDescriptors = descriptors(value);
		if (controlDescriptors) {
			const methods: InspectionValue[] = [];
			result.methods = methods;
			for (const [key, descriptor] of controlDescriptors) {
				if (
					typeof key !== "string" ||
					key.length > 256 ||
					isBlockedKey(key) ||
					hidden(path.concat(key)) ||
					typeof descriptor.value !== "function"
				)
					continue;
				const method: { [key: string]: InspectionValue } = { name: key };
				// Redaction and actual callable discovery happen before metadata lookup.
				const signature = lookupInspectionMethod(source, key, descriptor.value);
				if (!exposeControls && budget.methods) {
					budget.methods.push({ methods, method, signature });
					continue;
				}
				if (budget.remaining <= 0) {
					result.truncated = true;
					break;
				}
				budget.remaining--;
				if (signature) budget.signatures?.push({ method, signature });
				methods.push(method);
			}
		}
		const entries: InspectionValue[] = [];
		result.fields = entries;
		const available = fields(value);
		for (const field of available) {
			if (budget.remaining <= 0) {
				result.truncated = true;
				break;
			}
			const name = String(field.key);
			if (
				controlDescriptors &&
				typeof controlDescriptors.get(field.key)?.value === "function"
			)
				continue;
			if (name === "length" && Array.isArray(source)) continue;
			const nextPath = path.concat(name);
			const edge =
				field.type === "child"
					? "ownership"
					: field.type === "modelRef"
						? "reference"
						: "object";
			const entry: { [key: string]: InspectionValue } = {
				name: name.slice(0, 256),
				type: field.type ?? (field.getter ? "computed" : "value"),
				edge,
			};
			entries.push(entry);
			try {
				if (hidden(nextPath)) {
					budget.remaining--;
					entry.value = marker("redacted");
					continue;
				}
				if (typeof field.key === "symbol") {
					budget.remaining--;
					entry.value = marker("unsupported", "symbol key");
					continue;
				}
				if (
					adm instanceof StoreAdministration &&
					field.type === "child" &&
					!adm.peekInspectionChild(field.key).initialized
				) {
					budget.remaining--;
					entry.value = marker("uninitialized", "Not yet initialized");
					continue;
				}
				if (
					budget.evaluateComputeds === false &&
					field.getter &&
					!(adm instanceof StoreAdministration && field.type === "child")
				) {
					budget.remaining--;
					entry.value = marker("deferred", "Computed value not evaluated");
					continue;
				}
				if (exposeControls)
					entry.writable = writable(
						value,
						name,
						controlDescriptors.get(field.key)
					);
				const child = read(value, field, nextPath);
				entry.value = inspect(
					child,
					nextPath,
					depth - 1,
					budget,
					seen,
					exposeControls
				);
			} catch {
				budget.remaining--;
				entry.value = marker(
					"error",
					"Field evaluation failed (details withheld)"
				);
			}
		}
		return result;
	}
	const hiddenContext = (path: string[], name: string) =>
		hidden(path.concat("$context")) || hidden(path.concat("$context", name));
	function availableContexts(
		value: object,
		path: string[],
		paths: Map<object, string[]>
	) {
		const adm = administration(value);
		if (!(adm instanceof StoreAdministration) || adm.signal.aborted) return [];
		const chain: StoreAdministration[] = [];
		const seen = new Set<StoreAdministration>();
		for (
			let current: StoreAdministration | null = adm;
			current && chain.length < 64 && !seen.has(current);
			current = current.parent
		) {
			if (current.signal.aborted) break;
			chain.push(current);
			seen.add(current);
		}
		const incompleteChain = !!chain.at(-1)?.parent;
		const candidates = new Map<object, { declared: boolean; name?: string }>();
		for (const ref of declaredContexts(getSource(value)))
			candidates.set(ref.context, {
				declared:
					!ref.provided || candidates.get(ref.context)?.declared === true,
				name: ref.name,
			});
		for (const current of chain) {
			for (const ref of declaredContexts(current.source)) {
				if (
					ref.provided &&
					!candidates.has(ref.context) &&
					candidates.size < MAX_INSPECTION_CONTEXTS
				)
					candidates.set(ref.context, { declared: false, name: ref.name });
			}
		}
		const providerPaths = new Map<
			StoreAdministration,
			{ path?: string[]; blocked?: boolean }
		>();
		const providerPolicyPath = (provider: StoreAdministration) => {
			const cached = providerPaths.get(provider);
			if (cached) return cached;
			const target = chain.indexOf(provider);
			let anchor = -1;
			for (let i = target; i < chain.length; i++)
				if (paths.has(getSource(chain[i].source))) anchor = i;
			if (anchor < 0) return {};
			let resolved: { path?: string[]; blocked?: boolean } = {
				path: paths.get(getSource(chain[anchor].source))!,
			};
			for (let i = anchor; i > target && resolved.path; i--) {
				const next = chain[i - 1];
				let found: string[] | undefined;
				let uncertain = false;
				const retained = chain[i].getInspectionMetadata().fields;
				for (const field of retained.slice(0, 500)) {
					if (field.type !== "child" || typeof field.key !== "string") continue;
					const at = resolved.path.concat(field.key);
					if (hidden(at)) {
						uncertain = true;
						continue;
					}
					const child = chain[i].peekInspectionChild(field.key);
					if (!child.initialized || !child.value) continue;
					if (getSource(child.value) === getSource(next.source)) {
						found = at;
						break;
					}
					if (Array.isArray(child.value)) {
						const array = getSource(child.value);
						for (let j = 0; j < Math.min(array.length, 500); j++) {
							const itemPath = at.concat(String(j));
							if (hidden(itemPath)) {
								uncertain = true;
								continue;
							}
							const item = contextData(array, j);
							if (
								item &&
								typeof item === "object" &&
								getSource(item) === getSource(next.source)
							) {
								found = itemPath;
								break;
							}
						}
						if (array.length > 500) uncertain = true;
						if (found) break;
					}
				}
				resolved = found
					? { path: found }
					: { blocked: uncertain || retained.length > 500 };
				providerPaths.set(next, resolved);
			}
			providerPaths.set(provider, resolved);
			return resolved;
		};
		const result: {
			context: object;
			entry: InspectionContext;
			blocked: boolean;
		}[] = [];
		for (const [context, candidate] of candidates) {
			const meta = contextMetadata(context, candidate.name);
			const declared = candidate.declared;
			const entry: InspectionContext = {
				contextId: contextId(context),
				name: meta.name,
				...(meta.type ? { type: meta.type } : {}),
				status: "unavailable",
				...(declared ? { declared: true } : {}),
			};
			// Redact before looking for providers or constructing provider labels/IDs.
			if (hiddenContext(path, meta.name)) {
				entry.status = "redacted";
				result.push({ context, entry, blocked: true });
				continue;
			}
			const provide = contextData(context, "provide");
			let provider: StoreAdministration | undefined;
			let blocked = false;
			if (typeof provide === "symbol")
				for (const current of chain) {
					const descriptor = contextDescriptor(current.source, provide);
					if (!descriptor) continue;
					// A provider accessor cannot be resolved without executing user code.
					if (!("value" in descriptor)) {
						blocked = true;
						break;
					}
					if (typeof descriptor.value === "function") {
						provider = current;
						break;
					}
				}
			if (provider) {
				const policyPath = providerPolicyPath(provider);
				const providerPath = policyPath.path;
				if (
					policyPath.blocked ||
					(providerPath &&
						(providerPath.some((_, i) =>
							hidden(providerPath.slice(0, i + 1))
						) ||
							hiddenContext(providerPath, meta.name)))
				) {
					entry.status = "redacted";
					blocked = true;
				} else if (knownContextProvider(provider.source, context)) {
					entry.status = provider === adm ? "provided" : "inherited";
					entry.providerId = id(provider.source);
					const className = inspectionClassName(provider.source);
					if (className) entry.providerClass = className;
				}
			} else {
				blocked ||= incompleteChain;
				if (!blocked && meta.hasDefault === true) entry.status = "default";
			}
			result.push({ context, entry, blocked });
		}
		return result;
	}
	function readContext(
		request: Extract<InspectionRequest, { op: "context" }>
	): InspectionValue {
		const path = request.path ?? [];
		const paths = new Map<object, string[]>();
		const value = select(request.rootId, path, paths);
		if (
			!value ||
			typeof value !== "object" ||
			!(administration(value) instanceof StoreAdministration)
		)
			throw new Error("Select a live Store");
		const adm = administration(value) as StoreAdministration;
		if (adm.signal.aborted) throw new Error("Disposed runtime");
		const selected = availableContexts(value, path, paths).find(
			({ entry }) => entry.contextId === request.contextId
		);
		if (!selected)
			throw new Error("Unknown Context for selected Store; inspect again");
		if (selected.blocked || selected.entry.status === "redacted")
			throw new Error("Redacted or unsafe Context selection");
		const consume = contextData(selected.context, "consume");
		if (typeof consume !== "function")
			throw new Error("Context read unavailable");
		const registration = roots.get(request.rootId);
		try {
			// Deliberately explicit: normal Context receiver and Store proxy, no monkey-patching.
			const result = Reflect.apply(consume, selected.context, [adm.proxy]);
			if (
				disposed ||
				roots.get(request.rootId) !== registration ||
				adm.signal.aborted
			)
				return {
					ok: false,
					error: "Root detached or runtime disposed during Context read",
				};
			return {
				ok: true,
				result: inspect(
					result,
					path.concat("$context", selected.entry.name),
					request.depth ?? 2,
					{ remaining: request.maxEntries ?? 100 },
					new Set(),
					false
				),
			};
		} catch {
			return {
				ok: false,
				error: "Context evaluation failed (details withheld)",
			};
		}
	}
	function initialize(
		request: Extract<InspectionRequest, { op: "initialize" }>
	): InspectionValue {
		const path = request.path ?? [];
		const parent = select(request.rootId, path);
		if (!parent || typeof parent !== "object")
			throw new Error("Select a Store");
		const max = request.maxInitializations ?? 10;
		const levels = request.levels ?? 1;
		let initialized = 0;
		let visited = 0;
		let storesVisited = 0;
		let truncated = false;
		const errors: InspectionValue[] = [];
		const seen = new Set<object>();
		const visit = (
			value: object,
			fieldName: string,
			at: string[],
			left: number
		): void => {
			const adm = administration(value);
			if (!(adm instanceof StoreAdministration) || adm.signal.aborted)
				throw new Error("Select a live Store");
			if (
				!adm
					.getInspectionMetadata()
					.fields.some((f) => f.key === fieldName && f.type === "child")
			)
				throw new Error("Only declared Store children may be initialized");
			const childPath = at.concat(fieldName);
			if (hidden(childPath)) throw new Error("Redacted selection");
			if (visited >= max) {
				truncated = true;
				return;
			}
			visited++;
			let child = adm.peekInspectionChild(fieldName);
			if (!child.initialized) {
				// Use the public getter so normal lifecycle machinery is preserved.
				try {
					Reflect.get(adm.proxy, fieldName);
					child = adm.peekInspectionChild(fieldName);
					if (child.initialized) initialized++;
				} catch {
					errors.push({
						path: childPath,
						kind: "error",
						detail: "Child initialization failed (details withheld)",
					});
					return;
				}
			}
			if (left <= 1) return;
			const children = Array.isArray(child.value)
				? child.value
				: child.value
					? [child.value]
					: [];
			for (let i = 0; i < children.length; i++) {
				if (visited >= max || storesVisited >= max) {
					truncated = true;
					break;
				}
				storesVisited++;
				const store = children[i];
				if (seen.has(getSource(store))) continue;
				seen.add(getSource(store));
				const storePath = Array.isArray(child.value)
					? childPath.concat(String(i))
					: childPath;
				// Apply the same ancestor policy as path selection before traversing an item.
				if (hidden(storePath)) continue;
				for (const f of administration(store)!.getInspectionMetadata().fields) {
					if (
						f.type !== "child" ||
						typeof f.key !== "string" ||
						hidden(storePath.concat(f.key))
					)
						continue;
					if (visited >= max) {
						truncated = true;
						break;
					}
					visit(store, f.key, storePath, left - 1);
				}
			}
		};
		visit(parent, request.field, path, levels);
		return { initialized, visited, storesVisited, truncated, errors };
	}
	function controlledObject(rootId: string, path: string[]): object {
		if (options.controls !== true)
			throw new Error("Inspector controls are disabled");
		const value = select(rootId, path);
		if (!value || typeof value !== "object")
			throw new Error("Select an object");
		const source = getSource(value);
		if (
			!objectAdministration(value) &&
			!Array.isArray(source) &&
			Object.getPrototypeOf(source) !== Object.prototype &&
			Object.getPrototypeOf(source) !== null
		)
			throw new Error("Unsupported object internals");
		if (administration(value)?.getInspectionMetadata().status === "disposed")
			throw new Error("Disposed runtime");
		return value;
	}
	function writable(
		value: object,
		name: string,
		descriptor = descriptors(value).get(name)
	): boolean {
		if (isBlockedKey(name) || name.length > 256) return false;
		const adm = administration(value);
		if (adm instanceof StoreAdministration && name === "props") return false;
		if (
			adm
				?.getInspectionMetadata()
				.fields.some((f) => f.key === name && f.type === "child")
		)
			return false;
		return (
			!!descriptor &&
			("value" in descriptor
				? descriptor.writable === true &&
					typeof descriptor.value !== "function" &&
					!(Array.isArray(getSource(value)) && name === "length")
				: !!descriptor.set && !!objectAdministration(value))
		);
	}
	function setField(
		request: Extract<InspectionRequest, { op: "set" }>
	): InspectionValue {
		const path = request.path ?? [];
		const value = controlledObject(request.rootId, path);
		if (hidden(path.concat(request.field)))
			throw new Error("Redacted selection");
		if (!writable(value, request.field))
			throw new Error(
				"Select an existing writable field, not a child or method"
			);
		try {
			// Copy JSON data so later app writes cannot mutate the caller's request object.
			const input: unknown = JSON.parse(JSON.stringify(request.value));
			if (
				!Reflect.set(
					objectAdministration(value)?.proxy ?? value,
					request.field,
					input
				)
			)
				throw new Error("Write rejected");
			return { ok: true };
		} catch {
			return {
				ok: false,
				error: "Field write failed (details withheld); state may have changed",
			};
		}
	}
	async function callMethod(
		request: Extract<InspectionRequest, { op: "call" }>
	): Promise<InspectionValue> {
		const path = request.path ?? [];
		const value = controlledObject(request.rootId, path);
		const at = path.concat(request.method);
		const registration = roots.get(request.rootId);
		if (hidden(at)) throw new Error("Redacted selection");
		const descriptor = descriptors(value).get(request.method);
		if (!descriptor || typeof descriptor.value !== "function")
			throw new Error("Select an application method");
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = Symbol("timeout");
		try {
			const receiver = objectAdministration(value)?.proxy ?? value;
			const args: unknown[] = JSON.parse(JSON.stringify(request.args ?? []));
			const pending = Reflect.apply(
				Reflect.get(receiver, request.method),
				receiver,
				args
			);
			const result = await Promise.race([
				Promise.resolve(pending),
				new Promise<typeof timeout>((resolve) => {
					timer = setTimeout(() => resolve(timeout), 4000);
				}),
			]);
			if (result === timeout)
				return {
					ok: false,
					error:
						"Method timed out; it may still finish. Do not retry automatically.",
				};
			if (
				disposed ||
				roots.get(request.rootId) !== registration ||
				administration(value)?.getInspectionMetadata().status === "disposed"
			)
				return {
					ok: false,
					error:
						"Root detached or runtime disposed during method call; state may have changed",
				};
			return {
				ok: true,
				result: untracked(() =>
					inspect(
						result,
						at,
						request.depth ?? 2,
						{ remaining: request.maxEntries ?? 100 },
						new Set(),
						false // Return values are not retained navigation/control capabilities.
					)
				),
			};
		} catch {
			return {
				ok: false,
				error: "Method failed (details withheld); state may have changed",
			};
		} finally {
			clearTimeout(timer);
		}
	}
	function query(
		request: Extract<InspectionRequest, { op: "call" }>
	): Promise<InspectionValue>;
	function query(
		request: Exclude<InspectionRequest, { op: "call" }>
	): InspectionValue;
	function query(
		request: InspectionRequest
	): InspectionValue | Promise<InspectionValue>;
	function query(
		request: InspectionRequest
	): InspectionValue | Promise<InspectionValue> {
		validateRequest(request);
		if (disposed) throw new Error("Inspector disposed");
		return untracked((): InspectionValue | Promise<InspectionValue> => {
			if (request.op === "roots")
				return {
					controls: options.controls === true,
					roots: [...roots].map(([rootId, root]) => ({
						rootId,
						name: root.name,
						kind:
							administration(root.value) instanceof StoreAdministration
								? "Store"
								: "Model",
					})),
				};
			if (request.op === "operations") {
				if (hidden(["$operations"]))
					return {
						enabled: !!options.operations || !!activity,
						redacted: true,
						records: [],
					};
				return {
					enabled: !!options.operations || !!activity,
					canClear:
						(!!options.operations || !!activity) && options.controls === true,
					...(activity
						? {
								activity: {
									enabled: true,
									discoveryTruncated: activityDiscoveryTruncated,
								},
							}
						: {}),
					...boundedOperationRecords(
						[
							...(options.operations?.list() ?? []),
							...(activity
								?.list()
								.filter(
									(record) => !hidden(["$operations", record.id, "name"])
								) ?? []),
						]
							.sort((a, b) => b.startedAt - a.startedAt)
							.filter((record) => !hidden(["$operations", record.id]))
							.map((record) => ({
								...record,
								name: hidden(["$operations", record.id, "name"])
									? "[redacted]"
									: record.name,
								...(record.error !== undefined
									? {
											error: hidden(["$operations", record.id, "error"])
												? "[redacted]"
												: record.error,
										}
									: {}),
							}))
					),
				};
			}
			if (request.op === "clearOperations") {
				if (
					options.controls !== true ||
					(!options.operations && !activity) ||
					hidden(["$operations"])
				)
					throw new Error(
						"Operation clear requires controls and an available timeline"
					);
				options.operations?.clear();
				activity?.clear();
				return { ok: true };
			}
			if (request.op === "context") return readContext(request);
			if (request.op === "initialize") return initialize(request);
			if (request.op === "set") return setField(request);
			if (request.op === "call") return callMethod(request);
			const budget: InspectionBudget = {
				remaining: request.maxEntries ?? 100,
				evaluateComputeds: request.evaluateComputeds,
				signatures: [],
				methods: [],
				contexts: [],
				paths: new Map(),
			};
			const result = inspect(
				select(
					request.rootId,
					request.path ?? [],
					budget.paths,
					request.evaluateComputeds
				),
				request.path ?? [],
				request.depth ?? 2,
				budget,
				new Set()
			);
			for (const pending of budget.methods!) {
				if (budget.remaining <= 0) break;
				budget.remaining--;
				pending.methods.push(pending.method);
				if (pending.signature)
					budget.signatures!.push({
						method: pending.method,
						signature: pending.signature,
					});
			}
			// Enrich only after ALL live values have used the shared budget, including
			// sibling/descendant fields. Adding signatures must not displace app state.
			for (const { method, signature } of budget.signatures!) {
				const cost =
					(signature.returnType ? 1 : 0) +
					(signature.parameters?.reduce(
						(total, parameter) => total + 1 + (parameter.choices?.length ?? 0),
						0
					) ?? 0);
				if (cost > budget.remaining) continue;
				budget.remaining -= cost;
				if (signature.returnType) method.returnType = signature.returnType;
				if (signature.parameters)
					method.parameters = signature.parameters.map((parameter) => ({
						...parameter,
					}));
			}
			for (const pending of budget.contexts!) {
				if (budget.remaining <= 0) break;
				const available = availableContexts(
					pending.value,
					pending.path,
					budget.paths!
				);
				if (!available.length) continue;
				pending.result.contexts = available
					.slice(0, budget.remaining)
					.map(({ entry }) => ({ ...entry }));
				budget.remaining -= (
					pending.result.contexts as InspectionValue[]
				).length;
			}
			return result;
		});
	}
	return {
		registerRoot(name: string, value: Store | Model) {
			if (disposed) throw new Error("Inspector disposed");
			if (!administration(value))
				throw new Error("Register a live Store or Model instance");
			if (roots.size >= 100) throw new Error("Root limit reached");
			const rootId = id(value);
			if (roots.has(rootId)) throw new Error("Root already registered");
			roots.set(rootId, { name: name.slice(0, 100), value });
			activity?.start();
			activityPaths = new WeakMap();
			missingActivityPaths = new WeakSet();
			let registered = true;
			return {
				rootId,
				unregister: () => {
					if (!registered) return;
					registered = false;
					roots.delete(rootId);
					if (!roots.size) activity?.stop();
					activity?.clear();
					activityPaths = new WeakMap();
					missingActivityPaths = new WeakSet();
				},
			};
		},
		query,
		dispose() {
			disposed = true;
			activity?.dispose();
			roots.clear();
		},
	};
}
export type Inspector = ReturnType<typeof createInspector>;
